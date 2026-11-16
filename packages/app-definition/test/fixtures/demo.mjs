/* A small but complete definition used by tests: two roles, three records,
   a relationship, derived values, row access, actions with a precondition,
   and screens covering collection, record, related and form regions. */
import * as d from "../../src/index.mjs";

const M = "demo";
const f = (record, name) => ({ module: M, element: `${record}__${name}` });
const r = (element) => ({ module: M, element });

export function demoDefinition() {
  let doc = d.createApp({ id: "demo.timesheets", name: "Demo timesheets", module: M, roles: [{ id: "employee", name: "Employee" }, { id: "manager", name: "Manager" }] });
  doc = d.addRecord(doc, { id: "person", fields: [{ name: "name" }, { name: "email", type: "email" }] });
  doc = d.addRecord(doc, { id: "project", fields: [{ name: "name" }, { name: "rate", type: "money" }] });
  doc = d.addRecord(doc, { id: "entry", fields: [{ name: "day", type: "date" }, { name: "hours", type: "hours" }, { name: "status", type: "choice", values: ["draft", "submitted", "approved"] }, { name: "note", type: "longtext", required: false }] });
  doc = d.addRelationship(doc, { from: "entry", to: "project", field: "project_id" });
  doc = d.addRelationship(doc, { from: "entry", to: "person", field: "person_id" });
  doc = d.addDerived(doc, { record: "entry", name: "amount", type: "money", expression: { "*": [{ var: "row.hours" }, { coalesce: [{ sum: [{ related: "entry_project_id" }, "rate"] }, 0] }] } });
  doc = d.addDerived(doc, { record: "project", name: "hours_logged", type: "hours", expression: { sum: [{ related: "entry_project_id" }, "hours"] } });
  doc = d.addAccess(doc, { record: "entry", roles: ["employee"], when: { "==": [{ var: "row.person_id" }, { var: "user.key" }] } });
  doc = d.addAccess(doc, { record: "entry", roles: ["manager"] });
  doc = d.addAction(doc, { id: "log-time", name: "Log time", record: "entry", kind: "create", inputs: ["day", "project_id", "hours", "note", "person_id"], optional: ["note"], set: { status: "draft" }, roles: ["employee"], preconditions: [{ id: "positive-hours", when: { ">": [{ var: "params.hours" }, 0] }, message: "Hours must be more than zero" }] });
  doc = d.addAction(doc, { id: "submit-entry", name: "Submit", record: "entry", kind: "update", set: { status: "submitted" }, roles: ["employee"], preconditions: [{ id: "is-draft", when: { "==": [{ var: "params.target.status" }, "draft"] }, message: "Only draft entries can be submitted" }] });
  doc = d.addAction(doc, { id: "approve-entry", name: "Approve", record: "entry", kind: "update", set: { status: "approved" }, roles: ["manager"], preconditions: [{ id: "is-submitted", when: { "==": [{ var: "params.target.status" }, "submitted"] }, message: "Only submitted entries can be approved" }] });
  doc = d.addAction(doc, { id: "delete-entry", name: "Delete", record: "entry", kind: "delete", roles: ["employee"], preconditions: [{ id: "only-drafts", when: { "==": [{ var: "params.target.status" }, "draft"] }, message: "Only drafts can be deleted" }] });
  const statusMap = { draft: { tone: "neutral", label: "Draft" }, submitted: { tone: "evaluation", label: "Submitted" }, approved: { tone: "live", label: "Approved" } };
  doc = d.putScreen(doc, {
    id: "entries", title: "My time", pattern: "collection", roles: ["employee"],
    actions: [{ action: "log-time", label: "Log time", emphasis: "primary", bind: [{ parameter: "person_id", from: "user" }], inputs: [{ parameter: "day", control: "date" }, { parameter: "project_id", control: "select", options: { record: r("project"), label: f("project", "name") } }, { parameter: "hours", control: "hours" }, { parameter: "note", control: "textarea" }], success: { toast: "Time logged" } }],
    regions: [{ id: "list", kind: "collection", record: r("entry"), columns: [{ field: f("entry", "day"), format: "date" }, { value: d.rule({ cat: [{ map: [{ related: "entry_project_id" }, { var: "row.name" }] }] }), label: "Project" }, { field: f("entry", "hours"), format: "hours" }, { derived: "entry_amount", format: "currency" }, { field: f("entry", "status"), format: "status", status: statusMap }],
      rowActions: [{ action: "submit-entry", bind: [{ parameter: "target", from: "row" }], when: d.rule({ "==": [{ var: "row.status" }, "draft"] }), success: { toast: "Submitted" } }, { action: "delete-entry", emphasis: "destructive", bind: [{ parameter: "target", from: "row" }], confirm: { title: "Delete this entry?", message: "It is removed for good." }, when: d.rule({ "==": [{ var: "row.status" }, "draft"] }) }],
      empty: { title: "No time yet", message: "Log time to see it here." } }],
  });
  doc = d.putScreen(doc, {
    id: "review", title: "To approve", pattern: "collection", roles: ["manager"],
    regions: [{ id: "queue", kind: "collection", record: r("entry"), filter: d.rule({ "==": [{ var: "row.status" }, "submitted"] }), columns: [{ field: f("entry", "day"), format: "date" }, { field: f("entry", "hours"), format: "hours" }, { derived: "entry_amount", format: "currency" }],
      rowActions: [{ action: "approve-entry", bind: [{ parameter: "target", from: "row" }], success: { toast: "Approved" } }], empty: { title: "Nothing to approve" } }],
  });
  doc = d.putScreen(doc, {
    id: "projects", title: "Projects", pattern: "collection",
    regions: [{ id: "list", kind: "collection", record: r("project"), columns: [{ field: f("project", "name"), link: { screen: "project", param: d.rule({ var: "row.id" }) } }, { field: f("project", "rate"), format: "currency" }, { derived: "project_hours_logged", format: "hours" }], empty: { title: "No projects" } }],
  });
  doc = d.putScreen(doc, {
    id: "project", title: d.rule({ var: "record.name" }), pattern: "record", param: { id: "project", record: r("project") }, back: { screen: "projects" },
    regions: [{ id: "facts", kind: "record", fields: [{ field: f("project", "name") }, { field: f("project", "rate"), format: "currency" }, { derived: "project_hours_logged", format: "hours" }] },
      { id: "time", kind: "related", relationship: "entry_project_id", title: "Time on this project", columns: [{ field: f("entry", "day"), format: "date" }, { field: f("entry", "hours"), format: "hours" }], empty: { title: "No time on this project yet" } }],
  });
  doc = d.setNavigation(doc, {
    navigation: [{ id: "time", label: "My time", screen: "entries", roles: ["employee"], icon: "calendar" }, { id: "review", label: "To approve", screen: "review", roles: ["manager"], icon: "check" }, { id: "projects", label: "Projects", screen: "projects", icon: "settings" }],
    home: [{ roles: ["employee"], screen: "entries" }, { roles: ["manager"], screen: "review" }],
  });
  doc = d.setSamples(doc, { record: "person", rows: [{ id: "u1", name: "Priya Shah", email: "priya@example.org" }, { id: "u2", name: "Morgan Reyes", email: "morgan@example.org" }] });
  doc = d.setSamples(doc, { record: "project", rows: [{ id: "p1", name: "Acme rollout", rate: 120 }, { id: "p2", name: "Internal tools", rate: 90 }] });
  doc = d.setSamples(doc, { record: "entry", rows: [
    { id: "e1", day: "2026-11-09", project_id: "p1", person_id: "u1", hours: 1.5, status: "draft", note: "Migration review" },
    { id: "e2", day: "2026-11-10", project_id: "p2", person_id: "u1", hours: 3, status: "submitted" },
    { id: "e3", day: "2026-11-10", project_id: "p1", person_id: "u2", hours: 2, status: "approved" },
  ] });
  doc = d.setIdentities(doc, { record: "person", clock: "2026-11-12T10:00:00Z", identities: [{ id: "priya", name: "Priya Shah", roles: ["employee"], key: "u1" }, { id: "morgan", name: "Morgan Reyes", roles: ["manager"], key: "u2" }] });
  return doc;
}
