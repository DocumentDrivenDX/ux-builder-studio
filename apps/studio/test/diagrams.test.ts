/* The diagrams read from an app's definition: for the time tracker, each is a
   valid umf.visual 1.1 document that says what the app does (its records and
   relationships, the invoice's states and who moves them, each role's screens,
   who can do what), and @ux-builder/visuals draws it with no quality findings. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020.js";
import { apply, appDiagrams } from "@ux-builder/app-definition";
// @ts-ignore plain JS fixture
import { buildDefinition } from "../fixtures/time-tracker.build.mjs";
import { starterDefinition } from "../server/apps.ts";
// @ts-ignore plain JS package
import { render, check, createTheme, loadTheme } from "@ux-builder/visuals/node";

const require = createRequire(import.meta.url);
const schema = JSON.parse(readFileSync(require.resolve("@ux-builder/visuals/schema/umf-visual-1.1.0.schema.json"), "utf8"));
const validate = new (Ajv2020 as any)({ allErrors: true, strict: false }).compile(schema);

let diagrams: any[] = [];
const byId = (id: string) => diagrams.find((d) => d.id === id);
const visual = (id: string) => byId(id).doc.extensions["umf.visual"];

test("the time tracker has a data model, the invoice's states and journey, a flow per role, and an access matrix", async () => {
  const doc = await buildDefinition(apply, starterDefinition({ id: "app.time-tracker-diagrams", name: "Time tracker" }));
  diagrams = appDiagrams(doc);
  assert.deepEqual(diagrams.map((d) => d.id), ["data-model", "state-invoice-status", "handoff-invoice-status", "flow-employee", "flow-ap", "access"]);
  for (const d of diagrams) assert.ok(validate(d.doc.extensions["umf.visual"]), `${d.id}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
});

test("the data model has every record, its keys, and each relationship named after what it points at", () => {
  const v = visual("data-model");
  assert.deepEqual(v.nodes.map((n: any) => n.id).sort(), ["event", "expense", "invoice", "person", "project", "rate"]);
  const invoice = v.structure.entities.find((e: any) => e.node === "invoice");
  assert.deepEqual(invoice.fields.find((f: any) => f.name === "id").keys, ["pk"]);
  assert.deepEqual(invoice.fields.find((f: any) => f.name === "person_id").keys, ["fk"]);
  assert.ok(!invoice.fields.some((f: any) => /^derived/.test(f.type)), "derived values are off by default");
  const ref = v.structure.references.find((r: any) => r.from.node === "expense" && r.to.node === "invoice");
  assert.equal(ref.label, "Invoice");
  assert.equal(ref.toCardinality, "exactly-one");
});

test("the invoice's states come from its actions: from their preconditions, to the value they set, with who may run them", () => {
  const s = visual("state-invoice-status").state;
  assert.equal(s.initial, "draft");
  assert.deepEqual(s.final, ["paid"]);
  const t = (from: string, to: string) => s.transitions.find((x: any) => x.from === from && x.to === to);
  assert.equal(t("draft", "submitted").event, "Submit to accounts payable");
  assert.equal(t("draft", "submitted").guard, "Employee");
  assert.equal(t("returned", "submitted").path, "alternate");
  assert.equal(t("submitted", "approved").guard, "Accounts payable");
  assert.equal(t("approved", "paid").event, "Mark paid");
  assert.ok(!t("paid", "draft"), "nothing leaves paid");
});

test("the journey puts the main path first, then returns and resubmissions", () => {
  const m = visual("handoff-invoice-status").sequence.messages.map((x: any) => x.label);
  assert.deepEqual(m.slice(0, 3), ["Submit to accounts payable → submitted", "Approve → approved", "Mark paid → paid"]);
  assert.ok(m.includes("Return to employee → returned"));
});

test("each role's flow starts at its home screen and follows its menu", () => {
  const e = visual("flow-employee");
  assert.ok(e.edges.some((x: any) => x.from === "who-employee" && x.to === "time" && /starts here/.test(x.label)));
  assert.ok(e.nodes.some((n: any) => n.id === "invoice"), "the invoice record screen is reachable");
  assert.ok(!visual("flow-ap").nodes.some((n: any) => n.id === "time"), "accounts payable never sees the employee's calendar");
});

test("the access matrix has a row per action and a column per role", () => {
  const c = visual("access").comparison;
  assert.deepEqual(c.items.map((i: any) => i.label), ["Employee", "Accounts payable"]);
  const yes = (action: string, role: string) => c.values.find((v: any) => v.criterion === `action-${action}` && v.item === `role-${role}`)?.support;
  assert.equal(yes("approve-invoice", "ap"), "yes");
  assert.equal(yes("approve-invoice", "employee"), "no");
});

test("every diagram draws in a theme with no quality findings", async () => {
  const theme = createTheme(loadTheme("ux-builder-databricks", "light"), "light");
  for (const d of [...diagrams, ...appDiagrams(await buildDefinition(apply, starterDefinition({ id: "app.time-tracker-diagrams", name: "Time tracker" })), { derived: true }).slice(0, 1)]) {
    const r = await render(d.doc, { theme: "ux-builder-databricks", appearance: "light", output: "svg" });
    assert.match(r.content, /^<svg/);
    assert.deepEqual(check(r.layout, { theme }), [], `${d.id} draws cleanly`);
    const m = await render(d.doc, { theme: "ux-builder-databricks", appearance: "light", output: "mermaid" });
    assert.ok(m.content || m.text, `${d.id} has a portable text form`);
  }
});
