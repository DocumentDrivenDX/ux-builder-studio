/* The studio expert's conversation store: kept on disk, listed newest first,
   filed by app, searchable, restored in the shape OUI's panel reads, and
   renamed, archived and deleted. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "studio-conversations-"));
process.env.STUDIO_DATA_DIR = dir;
// After STUDIO_DATA_DIR is set: the store reads it when it loads.
const { conversations } = await import("../server/agent/conversations.ts");

const app = { id: "app.time-tracker", name: "Time tracker" };

test("a conversation is kept on disk with the model's history", () => {
  conversations.create("c1");
  conversations.appendUser("c1", "t1", "Build me a time tracker for invoices", app);
  conversations.persist("c1", "t1", [
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "ui_act", arguments: JSON.stringify({ action: "catalog_create_app", input: { name: "Time tracker" } }) } }] },
    { role: "tool", content: JSON.stringify({ ok: true }), tool_call_id: "call-1", name: "ui_act" },
    { role: "assistant", content: "Your time tracker is ready." },
  ] as any);
  assert.ok(existsSync(join(dir, "conversations", "c1.json")));
  assert.equal(conversations.historyFor("c1", "t2").length, 4);
  assert.equal(conversations.historyFor("c1", "t1").length, 0, "the running turn's own messages are not its history");
});

test("it restores as stored messages: text, tool calls with arguments, and their results", () => {
  const c = conversations.get("c1");
  assert.equal(c.title, "Build me a time tracker for invoices");
  assert.deepEqual(c.messages.map((m: any) => m.role), ["user", "assistant", "tool", "assistant"]);
  const call = (c.messages[1] as any).toolCalls[0];
  assert.equal(call.name, "ui_act");
  assert.equal(call.arguments.action, "catalog_create_app");
  assert.equal((c.messages[2] as any).toolCallId, "call-1");
  assert.equal(new Set(c.messages.map((m: any) => m.id)).size, 4, "message ids are unique");
});

test("the list is newest first, filed by app, and leaves out conversations with no message", async () => {
  conversations.create("empty");
  await new Promise((r) => setTimeout(r, 5));
  conversations.appendUser("c2", "t3", "What can the studio build?", null);
  const all = conversations.list({});
  assert.deepEqual(all.conversations.map((c) => c.conversationId), ["c2", "c1"]);
  assert.equal(all.total, 2);
  assert.deepEqual(conversations.list({ scopeId: app.id }).conversations.map((c) => c.conversationId), ["c1"]);
  assert.deepEqual(conversations.list({ scopeId: null }).conversations.map((c) => c.conversationId), ["c2"]);
  assert.equal(all.conversations[1].scope?.name, "Time tracker");
});

test("search matches every word, in the title or a message, with an excerpt", () => {
  const r = conversations.list({ search: "tracker ready" });
  assert.deepEqual(r.conversations.map((c) => c.conversationId), ["c1"]);
  assert.ok(r.conversations[0].matches?.some((m) => /ready/i.test(m.excerpt)));
  assert.equal(conversations.list({ search: "nothing like this" }).total, 0);
});

test("rename, archive and delete", () => {
  assert.equal(conversations.rename("c1", "Time tracker build").title, "Time tracker build");
  assert.equal(conversations.get("c1").title, "Time tracker build");
  assert.equal(conversations.rename("c1", null).title, null, "null names it after its first message again");
  conversations.update(["c2"], { archived: true }, () => null);
  assert.deepEqual(conversations.list({}).conversations.map((c) => c.conversationId), ["c1"]);
  assert.deepEqual(conversations.list({ status: "archived" }).conversations.map((c) => c.conversationId), ["c2"]);
  conversations.remove(["c2"]);
  assert.ok(!readdirSync(join(dir, "conversations")).includes("c2.json"));
  assert.throws(() => conversations.get("c2"), /no longer exists/);
  assert.throws(() => conversations.get("../etc/passwd"), /Not a conversation id/);
});
