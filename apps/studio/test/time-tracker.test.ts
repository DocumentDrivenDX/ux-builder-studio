/* The time tracker the agent builds is valid UMF, deploys to Postgres through
   UMF's table compiler, and behaves like time-tracker-2 on its own seed data:
   the same totals, periods, queues and rules. */
process.env.STUDIO_PG_MEMORY = "1";
import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { apply, indexDefinition, makeVariant, OPERATION_SCHEMAS, OPERATIONS_INPUT, readSnapshot, runAction } from "@ux-builder/app-definition";
// @ts-ignore plain JS fixture
import { BUILD, buildDefinition } from "../fixtures/time-tracker.build.mjs";
import { starterDefinition } from "../server/apps.ts";
import { validateDefinition } from "../server/umf.ts";
import { appStore, deployApp } from "../server/db.ts";

const NOW = "2026-11-12T12:00:00Z";
const people = {
  priya: { id: "priya", name: "Priya Shah", roles: ["employee"], key: "priya" },
  sam: { id: "sam", name: "Sam Lee", roles: ["employee"], key: "sam" },
  danaAp: { id: "dana-ap", name: "Dana Ortiz", roles: ["ap"], key: "dana" },
  morgan: { id: "morgan", name: "Morgan Reyes", roles: ["ap"], key: "morgan" },
};

let doc: any;
let idx: any;
test("every batch the agent sends matches the room's input schema and each operation's argument schema", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const room = ajv.compile(OPERATIONS_INPUT as object);
  for (const step of (BUILD.steps as any[]).filter((s: any) => s.action === "app_apply_operations")) {
    assert.ok(room(step.input), `${step.input.summary}: ${ajv.errorsText(room.errors)}`);
    for (const o of step.input.operations) {
      const check = ajv.compile((OPERATION_SCHEMAS as any)[o.op].args);
      assert.ok(check(o.args), `${o.op}: ${ajv.errorsText(check.errors)}`);
    }
  }
});
test("the recorded build produces a valid, renderable app", async () => {
  doc = await buildDefinition(apply, starterDefinition({ id: "app.time-tracker-test", name: "Time tracker" }));
  idx = indexDefinition(doc);
  const v = await validateDefinition(doc);
  assert.deepEqual(v.errors.map((e: any) => `${e.code} ${e.path} ${e.message}`), []);
  assert.equal(v.renderable, true);
  assert.deepEqual(v.unaccepted.map((e: any) => `${e.code} ${e.path} ${e.message}`), [], "no open UX warnings");
});

test("a variant of the app is valid UMF and records what it is a variant of", async () => {
  const variant = makeVariant(doc, { id: "app.time-tracker-test-variant-1", name: "Time tracker for contractors", note: "For outside contractors" });
  const v = await validateDefinition(variant);
  assert.deepEqual(v.errors.map((e: any) => `${e.code} ${e.path} ${e.message}`), []);
  assert.equal(variant.extensions["umf.app"].variantOf.id, "app.time-tracker-test");
});

test("UMF deploys its six tables and the seed loads", async () => {
  const dep = await deployApp(doc);
  assert.equal(dep.steps.filter((s) => /^CREATE TABLE/.test(s.sql.trim())).length, 6);
  assert.equal(dep.steps.filter((s) => s.kind === "foreignKey").length, 8);
});

const snap = (who: any) => readSnapshot(idx, appStore(doc), who, { now: NOW });
const byKey = (rows: any[], key: string) => rows.find((r) => r.$key === key);

test("an employee sees only their own invoices, with time-tracker-2's totals and periods", async () => {
  const s = await snap(people.priya);
  assert.deepEqual(s.records.invoice.map((r: any) => r.$key).sort(), ["d-acme", "d-tools", "inv-38", "inv-42", "inv-46", "inv-47"]);
  const t = (k: string) => byKey(s.records.invoice, k);
  assert.equal(t("d-acme").total, 240.5);
  assert.equal(t("d-acme").period, "9 Nov – 11 Nov");
  assert.equal(t("inv-46").total, 582.5);
  assert.equal(t("inv-42").total, 780);
  assert.equal(t("inv-38").total, 600);
  assert.equal(t("d-tools").total, 270);
  assert.equal(t("d-acme").missing_receipts, 1);
  assert.equal(t("d-acme").receipts_needed, "Add the receipt for Client site parking, 11 Nov before submitting.");
  assert.equal(t("inv-46").last_change, "Returned to you");
  assert.equal(t("inv-47").last_change, "Submitted 9 Nov");
  const projects = s.records.project.map((p: any) => `${p.name}|${p.kept_by}|${p.my_rate ?? ""}|${p.used_on_invoices}`).sort();
  assert.deepEqual(projects, ["Acme rollout|Organization|120|4 invoices", "Board prep|You|100|None", "Internal tools|Organization|90|2 invoices", "Northwind audit|Organization||None"]);
});

test("Sam's calendar stays hidden until he connects it; then six events appear", async () => {
  const before = await snap(people.sam);
  assert.equal(before.records.event.filter((e: any) => !e.manual).length, 0);
  const r = await runAction(idx, appStore(doc), people.sam, "connect-calendar", { target: "sam" }, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await snap(people.sam);
  assert.equal(after.records.event.filter((e: any) => !e.manual).length, 6);
});

test("accounts payable never sees drafts, and its queues match the prototype", async () => {
  const s = await snap(people.morgan);
  assert.ok(!s.records.invoice.some((r: any) => r.status === "draft"));
  const queue = s.records.invoice.filter((r: any) => r.status === "submitted" && !r.is_mine).map((r: any) => r.number).sort();
  assert.deepEqual(queue, ["INV-0045", "INV-0047", "INV-0048", "INV-0049", "INV-0050"]);
  assert.equal(byKey(s.records.invoice, "inv-50").review_note, "Has lines on the employee’s own project");
  assert.equal(byKey(s.records.invoice, "inv-50").total, 490);
  const toPay = s.records.invoice.filter((r: any) => r.status === "approved").map((r: any) => r.number).sort();
  assert.deepEqual(toPay, ["INV-0041", "INV-0042", "INV-0044"]);
  const dana = await snap(people.danaAp);
  assert.equal(dana.records.invoice.filter((r: any) => r.status === "submitted" && !r.is_mine).length, 4, "Dana's own invoice is not in her count");
});

test("the rules hold: receipts before submitting, no approving your own invoice, reasons for returns", async () => {
  const store = appStore(doc);
  const blocked = await runAction(idx, store, people.priya, "submit-invoice", { target: "d-acme", submitted_on: "2026-11-12" }, { now: NOW });
  assert.equal((blocked as any).code, "RECEIPTS");
  const own = await runAction(idx, store, people.danaAp, "approve-invoice", { target: "inv-49", approved_on: "2026-11-12" }, { now: NOW });
  assert.equal((own as any).code, "NOT_OWN");
  const noReason = await runAction(idx, store, people.morgan, "return-invoice", { target: "inv-47", return_reason: "" }, { now: NOW });
  assert.equal((noReason as any).code, "HAS_REASON");
  const ok = await runAction(idx, store, people.priya, "submit-invoice", { target: "d-tools", submitted_on: "2026-11-12" }, { now: NOW });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const approved = await runAction(idx, store, people.morgan, "approve-invoice", { target: "d-tools", approved_on: "2026-11-12" }, { now: NOW });
  assert.equal(approved.ok, true);
  const early = await runAction(idx, store, people.morgan, "mark-paid", { target: "d-tools", paid_on: "2026-11-01" }, { now: NOW });
  assert.equal((early as any).code, "AFTER_APPROVAL");
  const paid = await runAction(idx, store, people.morgan, "mark-paid", { target: "d-tools", paid_on: "2026-11-12" }, { now: NOW });
  assert.equal(paid.ok, true);
});
