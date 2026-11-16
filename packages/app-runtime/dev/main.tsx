/* Development harness: the demo definition (plus a schedule, stats, a notice
   and a document, added with the definition operations) rendered by
   <AppView> on an in-memory host, with a person switcher, an appearance
   switch and a screen jump for checking role access. */
import "@ux-builder/tokens/themes.css";
import "@ux-builder/tokens/fonts.css";
import "@ux-builder/ui/ui.css";
import "@ux-builder/ui/patterns.css";
import "../src/runtime.css";

import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppearanceSwitch, Select, ThemeProvider } from "@ux-builder/ui";
import { Cluster } from "@ux-builder/ui/patterns";
import * as d from "@ux-builder/app-definition";
import { demoDefinition } from "../../app-definition/test/fixtures/demo.mjs";
import { AppView, type AppDefinition, type AppEvent, type DataClient, type Identity, type Location } from "../src/index";
import { memoryHost } from "../src/engine";

const M = "demo";
const f = (record: string, name: string) => ({ module: M, element: `${record}__${name}` });
const r = (element: string) => ({ module: M, element });

/* The demo, extended: bookings on a week schedule, stats, a notice, and a project statement (a document). */
function harnessDefinition(): AppDefinition {
  let doc = demoDefinition();
  // The demo fixture reads related("project"), but addRelationship now names a relationship by its id
  // ("entry_project_id"); give the demo's relationships the names its expressions use.
  doc = d.applyPatch(doc, doc.modules[0].relationships.map((rel: { id: string }, i: number) => ({ op: "replace", path: `/modules/0/relationships/${i}/name`, value: rel.id.replace(/^entry_|_id$/g, "") })));
  doc = d.addRecord(doc, {
    id: "booking",
    fields: [
      { name: "title" },
      { name: "starts", type: "datetime" },
      { name: "ends", type: "datetime", required: false },
      { name: "hours", type: "hours", required: false },
      { name: "state", type: "choice", values: ["planned", "done"] },
    ],
  });
  doc = d.addRelationship(doc, { from: "booking", to: "project", field: "project_id" });
  doc = d.addDerived(doc, { record: "booking", name: "project_name", type: "text", expression: { first: [{ map: [{ related: "booking_project_id" }, { var: "row.name" }] }] } });
  doc = d.addAction(doc, { id: "book-time", name: "Book time", record: "booking", kind: "create", inputs: ["title", "project_id", "starts", "ends"], optional: ["ends"], set: { state: "planned" }, roles: ["employee", "manager"] });
  doc = d.addAction(doc, { id: "complete-booking", name: "Mark done", record: "booking", kind: "update", set: { state: "done" }, roles: ["employee", "manager"], preconditions: [{ id: "is-planned", when: { "==": [{ var: "params.target.state" }, "planned"] }, message: "Only planned bookings can be marked done" }] });
  doc = d.putScreen(doc, {
    id: "schedule", title: "Schedule", pattern: "schedule", description: "Booked work for the week.",
    actions: [{ action: "book-time", emphasis: "primary", inputs: [{ parameter: "title" }, { parameter: "project_id", control: "select", options: { record: r("project"), label: f("project", "name") } }, { parameter: "starts", control: "datetime" }, { parameter: "ends", control: "datetime" }], success: { toast: d.rule({ cat: ["Booked ", { var: "input.title" }] }) } }],
    regions: [
      { id: "tiles", kind: "stats", tiles: [
        { label: "Hours logged", value: d.rule({ sum: [{ rows: "entry" }, "hours"] }), format: "hours" },
        { label: "Drafts", value: d.rule({ count: [{ filter: [{ rows: "entry" }, { "==": [{ var: "row.status" }, "draft"] }] }] }), format: "number" },
        { label: "Bookings planned", value: d.rule({ count: [{ filter: [{ rows: "booking" }, { "==": [{ var: "row.state" }, "planned"] }] }] }), format: "number" },
      ] },
      { id: "tip", kind: "notice", tone: "info", title: "Bookings without an end last their hours", message: d.rule({ cat: ["Signed in as ", { var: "user.name" }] }) },
      { id: "week", kind: "schedule", title: "This week", record: r("booking"), start: f("booking", "starts"), end: f("booking", "ends"),
        label: { field: f("booking", "title") }, detail: { derived: "booking_project_name", label: "Project" }, colorBy: { derived: "booking_project_name", label: "Project" },
        hours: { from: 8, to: 18 }, legend: [{ label: "Tip:", description: "choose a booking to mark it done." }],
        eventActions: [{ action: "complete-booking", emphasis: "primary", bind: [{ parameter: "target", from: "row" }], when: d.rule({ "==": [{ var: "row.state" }, "planned"] }), success: { toast: "Marked done" } }],
        empty: { title: "Nothing booked this week", message: "Book time to see it here." } },
    ],
  });
  doc = d.putScreen(doc, {
    id: "statement", title: d.rule({ cat: ["Statement: ", { var: "record.name" }] }), pattern: "record", param: { id: "project", record: r("project") }, back: { screen: "project", param: d.rule({ var: "record.id" }) },
    regions: [{ id: "doc", kind: "document", title: d.rule({ cat: [{ var: "record.name" }, " statement"] }), sections: [
      { id: "summary", title: "Project", fields: [{ field: f("project", "name") }, { field: f("project", "rate"), format: "currency" }] },
      { id: "lines", title: "Time", relationship: "entry_project_id", columns: [{ field: f("entry", "day"), format: "date" }, { field: f("entry", "hours"), format: "hours" }, { derived: "entry_amount", format: "currency" }], empty: "No time yet.",
        totals: [{ derived: "project_hours_logged", label: "Hours", format: "hours" }, { value: d.rule({ sum: [{ related: "entry_project_id" }, "amount"] }), label: "Total", format: "currency" }] },
    ] }],
  });
  // The projects list links to each project's statement.
  const ux: { screens: Array<{ id: string; regions: Array<{ columns: unknown[] }> }>; shell: { navigation: unknown[] } } = doc.extensions["umf.ux"];
  const projects = ux.screens.find((s) => s.id === "projects")!;
  projects.regions[0].columns.push({ value: d.rule("Statement"), label: "Statement", link: { screen: "statement", param: d.rule({ var: "row.id" }) } });
  doc = d.putScreen(doc, projects);
  doc = d.setNavigation(doc, { navigation: [...ux.shell.navigation, { id: "schedule", label: "Schedule", screen: "schedule", icon: "calendar" }] });
  doc = d.setSamples(doc, { record: "booking", rows: [
    { id: "b1", title: "Kick-off", project_id: "p1", starts: "2026-11-09T09:00:00Z", ends: "2026-11-09T10:30:00Z", state: "done" },
    { id: "b2", title: "Data migration", project_id: "p1", starts: "2026-11-10T13:00:00Z", ends: "2026-11-10T16:00:00Z", state: "planned" },
    { id: "b3", title: "Tool review", project_id: "p2", starts: "2026-11-10T14:00:00Z", ends: "2026-11-10T15:00:00Z", state: "planned" },
    { id: "b4", title: "Pairing", project_id: "p2", starts: "2026-11-12T08:30:00Z", hours: 2, state: "planned" },
    { id: "b5", title: "Retro", project_id: "p1", starts: "2026-11-13T16:00:00Z", ends: "2026-11-13T17:00:00Z", state: "planned" },
    { id: "b6", title: "Next sprint", project_id: "p2", starts: "2026-11-17T10:00:00Z", ends: "2026-11-17T11:00:00Z", state: "planned" },
  ] });
  return doc as AppDefinition;
}

// ?theme=<name> overrides the definition's theme; ?delay=<ms> slows every snapshot (to see loading states).
const query = new URLSearchParams(window.location.search);
const themeOverride = query.get("theme") ?? undefined;
const delay = Number(query.get("delay")) || 0;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function Harness() {
  const definition = useMemo(harnessDefinition, []);
  const host = useMemo(() => memoryHost(definition), [definition]);
  const people: Identity[] = definition.extensions["umf.app"].samples.identities;
  const [who, setWho] = useState(people[0].id);
  const [appearance, setAppearance] = useState<"light" | "dark" | "system">("light");
  const [location, setLocation] = useState<Location | undefined>(undefined);
  const identity = people.find((p) => p.id === who)!;
  const client: DataClient = useMemo(() => ({
    identity,
    snapshot: async () => { if (delay) await wait(delay); return host.snapshot(identity) as ReturnType<DataClient["snapshot"]>; },
    run: (action, params) => host.run(identity, action, params),
    subscribe: (l) => host.subscribe(l),
  }), [host, identity]);
  const screens = definition.extensions["umf.ux"].screens.filter((s: { param?: unknown }) => !s.param).map((s: { id: string }) => ({ value: s.id, label: s.id }));
  const log = (e: AppEvent) => console.info("[app event]", e.type, JSON.stringify(e));

  return (
    <ThemeProvider theme="plain" appearance={appearance} favicon={false} className="app-rt">
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", blockSize: "100dvh" }}>
        <Cluster gap={4} style={{ padding: "var(--piq-space-2) var(--piq-space-4)", borderBlockEnd: "var(--piq-border-default)" }}>
          <Select label="Signed in as" value={who} onChange={(e: { target: { value: string } }) => { setWho(e.target.value); setLocation(undefined); }}
            options={people.map((p) => ({ value: p.id, label: `${p.name} (${p.roles.join(", ")})` }))} data-testid="who" />
          <Select label="Go to screen" value={location?.screen ?? ""} placeholder="(home)" onChange={(e: { target: { value: string } }) => setLocation({ screen: e.target.value })} options={screens} data-testid="goto" />
          <AppearanceSwitch value={appearance} onChange={setAppearance} />
        </Cluster>
        <div style={{ minBlockSize: 0, position: "relative" }}>
          <AppView key={who} definition={definition} client={client} appearance={appearance} theme={themeOverride} adapt="container"
            location={location} onLocationChange={setLocation} onEvent={log} data-non-agent="" />
        </div>
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
