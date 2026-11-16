/* The studio's agent: OUI's realtime server and container agent worker, run
   locally in this process, with conversations kept on disk (./conversations.ts). The agent's
   only way to change an app is the studio UI's own controls and its "app" room
   (OUI surfaces the tab reports on every turn), so everything it does is
   something the person could do by hand, through the same code path. */

import { randomUUID, randomBytes } from "node:crypto";
import type express from "express";
import { createRealtimeServer, type RoomPolicy } from "@ouispec/agent-realtime";
import { historyOf, startContainerAgentWorker, type AgentTurnPayload, type TurnHistoryMessage } from "@ouispec/agent-worker";
import { generateText } from "ai";
import { pickModel, describeModel } from "./model.js";
import { systemPrompt } from "./knowledge.js";
import { ConversationError, conversations, type Scope } from "./conversations.js";
import { listApps } from "../apps.js";

export const LOCAL_USER = { userId: "studio-user", accountId: "studio" } as const;
const SESSION_TOKEN = process.env.STUDIO_SESSION_TOKEN ?? `studio-${randomBytes(12).toString("hex")}`;

/* Which turn runs in each conversation now (only while this process runs). */
const running = new Map<string, string>();

/* The app a message is about: the one open in the studio when it was sent. */
function scopeOf(appId: string | null | undefined): Scope | null {
  if (!appId) return null;
  const app = listApps().find((a: any) => a.id === appId);
  return { id: appId, name: app?.name ?? appId };
}
const appOfPath = (path: unknown) => {
  const m = typeof path === "string" ? /^\/apps\/([^/?#]+)/.exec(path) : null;
  return m ? decodeURIComponent(m[1]) : null;
};

const store = {
  create: (id: string) => conversations.create(id),
  appendUser(conversationId: string, turnId: string, content: string, scope: Scope | null) {
    conversations.appendUser(conversationId, turnId, content, scope);
    running.set(conversationId, turnId);
  },
  historyFor: (conversationId: string, turnId: string): TurnHistoryMessage[] => conversations.historyFor(conversationId, turnId),
  persist: (conversationId: string, turnId: string, msgs: TurnHistoryMessage[]) => conversations.persist(conversationId, turnId, msgs),
  runningTurn: (conversationId: string) => running.get(conversationId) ?? null,
  turnEnded(turnId: string) { for (const [c, t] of running) if (t === turnId) running.delete(c); },
};

export async function startAgent({ webOrigins, realtimePort = 3331, workerPort = 8091 }: { webOrigins: string[]; realtimePort?: number; workerPort?: number }) {
  const internalKey = randomBytes(24).toString("hex");
  const roomSecret = randomBytes(32).toString("hex");
  const approvalKey = randomBytes(32).toString("hex");
  const workerKey = randomBytes(24).toString("hex");

  const roomPolicy: RoomPolicy = {
    isValidRoom: (room) => /^user:[\w-]+$|^turn:[\w-]+$|^conversation:[\w-]+$/.test(room),
    identityRooms: (user) => [`user:${user.userId}`],
    requiresToken: (room) => room.startsWith("turn:") || room.startsWith("conversation:"),
    canJoin: (room, user) => room === `user:${user.userId}`,
  };
  const realtime = await createRealtimeServer({
    auth: {
      async verify(token: string) {
        if (token !== SESSION_TOKEN) throw new Error("unknown session");
        return { ...LOCAL_USER };
      },
    },
    roomPolicy,
    internalApiKey: internalKey,
    roomTokens: { secret: roomSecret },
    approvals: { signingKey: approvalKey },
    redis: { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379), tls: false },
    corsOrigins: webOrigins,
    port: realtimePort,
  } as any);
  const realtimeUrl = `http://127.0.0.1:${realtime.port}`;

  const { model, extras, label } = pickModel();

  /* Is the model usable right now? A tiny request at start-up, then every
     minute while it is not, so the assistant panel can say why (no credits, a
     bad key, an unknown model) and clear itself once it is fixed. */
  const health: { ok: boolean; problem: string | null; checkedAt: string | null } = { ok: label === "scripted", problem: null, checkedAt: null };
  const check = async () => {
    if (label === "scripted") return;
    try {
      await generateText({ model, prompt: "Reply with the word ok.", maxOutputTokens: 8, ...(extras.temperature === null ? {} : {}) } as any);
      health.ok = true;
      health.problem = null;
    } catch (e: any) {
      health.ok = false;
      const raw = e?.data?.error?.message ?? e?.message ?? String(e);
      health.problem = /credit balance/i.test(raw)
        ? "The AI provider account has no credits. Add credits in the Claude Console (Settings → Billing); the assistant starts working as soon as they land."
        : /api.key|authentication|x-api-key|401/i.test(raw)
          ? "The AI provider rejected the API key. Check ANTHROPIC_API_KEY / OPENAI_API_KEY in apps/studio/.env and restart the studio."
          : `The AI model is not available: ${raw}`;
    }
    health.checkedAt = new Date().toISOString();
    if (!health.ok) setTimeout(check, 60000).unref();
  };
  void check();
  const worker = await startContainerAgentWorker({
    model,
    ...extras,
    realtime: { url: realtimeUrl, apiKey: internalKey },
    systemPrompt: () => systemPrompt(),
    tools: [],
    maxRounds: 24,
    // Building an app runs UMF validation and a Postgres deploy inside a page action;
    // give the tab time to answer.
    uiActions: { resultTimeoutMs: 240000 },
    toolTimeoutMs: 240000,
    getDb: async () => ({}),
    getHistory: async (conversationId: string, _db: unknown, turn: { turnId: string }) => store.historyFor(conversationId, turn.turnId),
    persistMessages: async ({ turnId, conversationId, messages }: any) => { store.persist(conversationId, turnId, historyOf(messages)); },
    onTurnEnd: (outcome: any) => store.turnEnded(outcome.turnId),
    port: workerPort,
    workerApiKey: workerKey,
  } as any);
  const workerUrl = `http://127.0.0.1:${worker.port}`;

  const internal = async (path: string, body: unknown) => {
    const res = await fetch(`${realtimeUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": internalKey }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<any>;
  };

  function mount(app: express.Express) {
    app.get("/api/agent/session", (_req, res) => {
      res.json({ realtimeUrl: `http://localhost:${realtime.port}`, token: SESSION_TOKEN, model: label, description: describeModel(label), available: health.ok, problem: health.problem, checkedAt: health.checkedAt });
    });
    app.post("/api/agent/conversations", (_req, res) => {
      const conversationId = randomUUID();
      store.create(conversationId);
      res.json({ conversationId });
    });
    app.post("/api/agent/conversations/:id/messages", async (req, res, next) => {
      try {
        const conversationId = String(req.params.id);
        const { content = "", context, approval, resume } = req.body ?? {};
        const turnId = randomUUID();
        const socketRoom = `turn:${turnId}`;
        const previous = !approval && !resume ? store.runningTurn(conversationId) : null;
        if (previous) await internal(`/internal/turns/${previous}/stop`, { userId: LOCAL_USER.userId, reason: "superseded" }).catch(() => {});
        store.appendUser(conversationId, turnId, approval || resume ? "" : content, scopeOf(appOfPath(context?.currentPath)));
        const { token } = await internal("/internal/room-token", { userId: LOCAL_USER.userId, room: socketRoom });
        const payload: AgentTurnPayload = {
          turnId, conversationId, socketRoom,
          userId: LOCAL_USER.userId, accountId: LOCAL_USER.accountId,
          content, context: context ?? null,
          ...(approval ? { approval } : {}),
          ...(resume ? { resume } : {}),
          ...(previous ? { supersedes: [previous] } : {}),
        } as AgentTurnPayload;
        const sent = await fetch(`${workerUrl}/turns`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": workerKey }, body: JSON.stringify(payload) });
        if (sent.status !== 202) return res.status(502).json({ ok: false, code: "WORKER", message: `The agent did not take the turn: ${sent.status} ${await sent.text()}` });
        res.json({ turnId, socketRoom, roomToken: token });
      } catch (e) {
        next(e);
      }
    });
    /* History: the conversations the person can return to. */
    const handle = (fn: (req: express.Request) => unknown, status = 200) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        const out = fn(req);
        if (status === 204) res.status(204).end();
        else res.status(status).json(out);
      } catch (e) {
        if (e instanceof ConversationError) res.status(e.status).json({ ok: false, code: e.code, message: e.message });
        else next(e);
      }
    };
    app.get("/api/agent/conversations", handle((req) => {
      const q = req.query as Record<string, string | undefined>;
      return conversations.list({
        limit: Math.min(Number(q.limit ?? 50) || 50, 200),
        offset: Number(q.offset ?? 0) || 0,
        scopeId: q.scopeId === undefined ? undefined : q.scopeId === "" ? null : q.scopeId,
        status: (q.status as any) ?? "active",
        search: q.search,
      });
    }));
    app.get("/api/agent/conversations/:id", handle((req) => conversations.get(String(req.params.id))));
    app.patch("/api/agent/conversations/:id", handle((req) => conversations.rename(String(req.params.id), req.body?.title ?? null)));
    app.post("/api/agent/conversations/update", handle((req) => {
      const ids: string[] = req.body?.conversationIds ?? [];
      if (ids.some((id) => running.has(id) && req.body?.changes?.archived)) throw new ConversationError(409, "RUNNING", "That conversation is still answering");
      return conversations.update(ids, req.body?.changes ?? {}, scopeOf);
    }));
    app.post("/api/agent/conversations/delete", handle((req) => {
      const ids: string[] = req.body?.conversationIds ?? [];
      if (ids.some((id) => running.has(id))) throw new ConversationError(409, "RUNNING", "That conversation is still answering");
      conversations.remove(ids);
    }, 204));
    app.post("/api/agent/turns/:turnId/stop", async (req, res, next) => {
      try {
        await internal(`/internal/turns/${req.params.turnId}/stop`, { userId: LOCAL_USER.userId, reason: "user_stop" });
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    });
  }

  return {
    mount,
    model: label,
    health,
    async close() {
      await worker.close?.();
      await realtime.close();
    },
  };
}
