/* End to end below the UI: a definition built with the studio's operations is
   valid UMF, deploys through UMF's own table compiler to PostgreSQL 18, and
   runs (access rules, derived values, actions, preconditions) on those tables. */
process.env.STUDIO_PG_MEMORY = "1";
import test from "node:test";
import assert from "node:assert/strict";
import { indexDefinition, readSnapshot, runAction } from "@ux-builder/app-definition";
// @ts-ignore fixture is plain JS
import { demoDefinition } from "../../../packages/app-definition/test/fixtures/demo.mjs";
import { validateDefinition } from "../server/umf.ts";
import { deployApp, appStore } from "../server/db.ts";

const doc = demoDefinition();
const idx = indexDefinition(doc);
const priya = { id: "priya", name: "Priya Shah", roles: ["employee"], key: "u1" };
const morgan = { id: "morgan", name: "Morgan Reyes", roles: ["manager"], key: "u2" };

test("the definition is valid UMF and renderable under app profile 0.1", async () => {
  const v = await validateDefinition(doc);
  assert.deepEqual(v.errors, [], JSON.stringify(v.errors, null, 1));
  assert.equal(v.renderable, true);
});

test("UMF deploys the tables and the engine reads them with access and derived values", async () => {
  const dep = await deployApp(doc);
  assert.ok(dep.steps.some((s) => s.kind === "table"));
  assert.ok(dep.steps.some((s) => s.kind === "foreignKey"));
  const store = appStore(doc);
  const mine = await readSnapshot(idx, store, priya, { now: "2026-11-12T10:00:00Z" });
  assert.deepEqual(mine.records.entry.map((r: any) => r.$key).sort(), ["e1", "e2"], "an employee sees only their own entries");
  assert.equal(mine.records.entry.find((r: any) => r.$key === "e1").amount, 180, "amount = hours × project rate");
  const all = await readSnapshot(idx, store, morgan, { now: "2026-11-12T10:00:00Z" });
  assert.equal(all.records.entry.length, 3, "a manager sees every entry");
  assert.equal(all.records.project.find((r: any) => r.$key === "p1")!.hours_logged, 3.5);
});

test("actions check authorization and preconditions, then write through to Postgres", async () => {
  const store = appStore(doc);
  const denied = await runAction(idx, store, morgan, "submit-entry", { target: "e1" });
  assert.equal(denied.ok, false);
  assert.equal((denied as any).code, "FORBIDDEN");
  const zero = await runAction(idx, store, priya, "log-time", { day: "2026-11-12", project_id: "p1", hours: 0, person_id: "u1" });
  assert.equal((zero as any).code, "POSITIVE_HOURS");
  const created = await runAction(idx, store, priya, "log-time", { day: "2026-11-12", project_id: "p1", hours: 2.25, person_id: "u1", note: "Cutover" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const submitted = await runAction(idx, store, priya, "submit-entry", { target: (created as any).created.key });
  assert.equal(submitted.ok, true);
  const again = await runAction(idx, store, priya, "submit-entry", { target: (created as any).created.key });
  assert.equal((again as any).code, "IS_DRAFT");
  const approved = await runAction(idx, store, morgan, "approve-entry", { target: (created as any).created.key });
  assert.equal(approved.ok, true);
  const rows = await store.all("entry");
  assert.equal(rows.find((r: any) => r.id === (created as any).created.key)!.status, "approved");
});
