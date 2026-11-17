/* The App Expert's conversations, kept on disk so they survive a reload, a
   restart and a new tab: one JSON file per conversation under
   .data/conversations (or STUDIO_DATA_DIR/conversations). Each holds the turns'
   messages as the agent worker hands them back (the model's history), plus
   what the history list shows: a title, when it was active, the app it is
   about (its scope) and whether it is archived. */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TurnHistoryMessage } from "@ouispec/agent-worker";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(process.env.STUDIO_DATA_DIR ?? join(here, "..", "..", ".data"), "conversations");

export type Scope = { id: string; name: string };
type Entry = { turnId: string; at: string; msg: TurnHistoryMessage };
type Conversation = {
  conversationId: string;
  /** The person's own name for it; null means it is named after its first message. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  archivedAt: string | null;
  scope: Scope | null;
  /** Whose conversation it is (their email); conversations from before sign-in have none and are everyone's. */
  owner?: string | null;
  entries: Entry[];
};

export type Summary = {
  conversationId: string;
  title: string | null;
  preview: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  scope: Scope | null;
  archivedAt: string | null;
  matches?: Array<{ messageId: string; role: "user" | "assistant"; excerpt: string; createdAt: string }>;
};

export class ConversationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const ID = /^[\w-]{1,80}$/;
const fileOf = (id: string) => {
  if (!ID.test(id)) throw new ConversationError(400, "BAD_ID", `Not a conversation id: ${id}`);
  return join(ROOT, `${id}.json`);
};
const now = () => new Date().toISOString();

const cache = new Map<string, Conversation>();
function load(id: string): Conversation | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const file = fileOf(id);
  if (!existsSync(file)) return null;
  const c = JSON.parse(readFileSync(file, "utf8")) as Conversation;
  cache.set(id, c);
  return c;
}
function save(c: Conversation) {
  mkdirSync(ROOT, { recursive: true });
  const file = fileOf(c.conversationId);
  // Written whole, then moved into place, so a crash never leaves half a file.
  writeFileSync(`${file}.tmp`, JSON.stringify(c, null, 1));
  renameSync(`${file}.tmp`, file);
  cache.set(c.conversationId, c);
}
function need(id: string) {
  const c = load(id);
  if (!c) throw new ConversationError(404, "NOT_FOUND", "That conversation no longer exists");
  return c;
}

const firstUser = (c: Conversation) => c.entries.find((e) => e.msg.role === "user" && e.msg.content)?.msg.content as string | undefined;
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const messageId = (e: Entry, i: number) => `${e.turnId}-${i}`;

function summary(c: Conversation): Summary {
  const first = firstUser(c);
  return {
    conversationId: c.conversationId,
    title: c.title,
    preview: first ? oneLine(first, 140) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lastActiveAt: c.lastActiveAt,
    scope: c.scope,
    archivedAt: c.archivedAt,
  };
}

export const conversations = {
  create(id: string, owner: string | null = null) {
    const t = now();
    save({ conversationId: id, title: null, createdAt: t, updatedAt: t, lastActiveAt: t, archivedAt: null, scope: null, owner, entries: [] });
  },

  /** Whether a person may see a conversation: their own, or one from before sign-in. */
  mayOpen(id: string, owner: string) {
    const c = load(id);
    return !c || !c.owner || c.owner.toLowerCase() === owner.toLowerCase();
  },

  /** The person's message starts a turn. The conversation is filed under the app it is about, when there is one. */
  appendUser(id: string, turnId: string, content: string, scope: Scope | null) {
    const c = load(id) ?? (this.create(id), need(id));
    const t = now();
    if (content) c.entries.push({ turnId, at: t, msg: { role: "user", content } });
    if (scope) c.scope = scope;
    c.lastActiveAt = t;
    c.updatedAt = t;
    save(c);
  },

  /** What the model is given: every stored message except the running turn's. */
  historyFor(id: string, turnId: string): TurnHistoryMessage[] {
    return (load(id)?.entries ?? []).filter((e) => e.turnId !== turnId).map((e) => e.msg);
  },

  persist(id: string, turnId: string, msgs: TurnHistoryMessage[]) {
    const c = load(id) ?? (this.create(id), need(id));
    const t = now();
    c.entries.push(...msgs.map((msg) => ({ turnId, at: t, msg })));
    c.lastActiveAt = t;
    c.updatedAt = t;
    save(c);
  },

  list({ limit = 50, offset = 0, scopeId, status = "active", search, owner }: { limit?: number; offset?: number; scopeId?: string | null; status?: "active" | "archived" | "all"; search?: string; owner?: string }) {
    mkdirSync(ROOT, { recursive: true });
    const words = (search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const all: Summary[] = [];
    for (const f of readdirSync(ROOT)) {
      if (!f.endsWith(".json")) continue;
      const c = load(f.slice(0, -5));
      // A conversation the person never wrote in is not history.
      if (!c || !firstUser(c)) continue;
      if (owner && c.owner && c.owner.toLowerCase() !== owner.toLowerCase()) continue;
      if (status === "active" && c.archivedAt) continue;
      if (status === "archived" && !c.archivedAt) continue;
      if (scopeId !== undefined && (c.scope?.id ?? null) !== scopeId) continue;
      const s = summary(c);
      if (words.length) {
        const texts = c.entries
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => (e.msg.role === "user" || e.msg.role === "assistant") && e.msg.content);
        const hay = [c.title ?? "", ...texts.map(({ e }) => e.msg.content as string)].join("\n").toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        s.matches = texts
          .filter(({ e }) => words.some((w) => (e.msg.content as string).toLowerCase().includes(w)))
          .slice(0, 3)
          .map(({ e, i }) => {
            const text = (e.msg.content as string).replace(/\s+/g, " ");
            const at = Math.max(0, text.toLowerCase().indexOf(words.find((w) => text.toLowerCase().includes(w)) ?? "") - 40);
            return { messageId: messageId(e, i), role: e.msg.role as "user" | "assistant", excerpt: oneLine(`${at > 0 ? "…" : ""}${text.slice(at)}`, 160), createdAt: e.at };
          });
      }
      all.push(s);
    }
    all.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    return { conversations: all.slice(offset, offset + limit), total: all.length };
  },

  /** One conversation with its messages, in the shape OUI's panel restores. */
  get(id: string) {
    const c = need(id);
    const messages = c.entries.map((e, i) => {
      const base = { id: messageId(e, i), createdAt: e.at };
      const m = e.msg as any;
      if (m.role === "assistant") {
        return {
          ...base, role: "assistant", content: m.content ?? null,
          toolCalls: (m.tool_calls ?? []).map((tc: any) => ({ id: tc.id, name: tc.function?.name, arguments: parseArgs(tc.function?.arguments) })),
          ...(m.stopped ? { stopped: m.stopped } : {}),
        };
      }
      if (m.role === "tool") return { ...base, role: "tool", content: m.content ?? null, toolCallId: m.tool_call_id ?? null };
      return { ...base, role: m.role, content: m.content ?? null };
    });
    return { conversationId: c.conversationId, title: c.title ?? (firstUser(c) ? oneLine(firstUser(c)!, 80) : null), messages };
  },

  rename(id: string, title: string | null) {
    const c = need(id);
    c.title = title && title.trim() ? oneLine(title, 120) : null;
    c.updatedAt = now();
    save(c);
    return summary(c);
  },

  update(ids: string[], changes: { scopeId?: string | null; archived?: boolean }, scopeOf: (id: string) => Scope | null) {
    const list = ids.map(need);
    const t = now();
    for (const c of list) {
      if (changes.archived !== undefined) c.archivedAt = changes.archived ? t : null;
      if (changes.scopeId !== undefined) c.scope = changes.scopeId ? scopeOf(changes.scopeId) : null;
      c.updatedAt = t;
      save(c);
    }
    return list.map(summary);
  },

  remove(ids: string[]) {
    for (const id of ids) need(id);
    for (const id of ids) {
      rmSync(fileOf(id), { force: true });
      cache.delete(id);
    }
  },
};

function parseArgs(s: unknown) {
  if (typeof s !== "string") return (s as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}
