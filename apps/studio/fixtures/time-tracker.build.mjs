/* The time tracker, as the studio's agent builds it: a request, then batches
   of operations sent through the app room (each validated by UMF and saved as
   a version). The scripted builder replays these steps; with a real model the
   agent writes its own. It reproduces time-tracker-2 (the hand-built ux-builder
   prototype) as a definition: no app code. Differences are listed in
   DIFFERENCES below and in the user-test report. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rule } from "@ux-builder/app-definition";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = JSON.parse(readFileSync(join(here, "time-tracker.samples.json"), "utf8"));

const M = "app";
const R = (record) => ({ module: M, element: record });
const F = (record, field) => ({ module: M, element: `${record}__${field}` });
const v = (name) => ({ var: name });
const eq = (a, b) => ({ "==": [a, b] });
const and = (...a) => ({ and: a });
const or = (...a) => ({ or: a });
const not = (a) => ({ not: a });
const present = (a) => ({ present: a });
const today = { today: [] };
const mine = eq(v("row.person_id"), v("user.key"));
const editable = (status) => ({ in: [status, ["draft", "returned"]] });

const STATUS = {
  draft: { tone: "neutral", label: "Draft" },
  submitted: { tone: "evaluation", label: "Submitted" },
  returned: { tone: "limited", label: "Returned" },
  approved: { tone: "live", label: "Approved" },
  paid: { tone: "closed", label: "Paid" },
};

/* ---------- batch 1: roles and the records ---------- */
const records = [
  { op: "setIdentity", args: { name: "Time tracker", description: "Employees turn calendar time into invoices with expenses and receipts; accounts payable reviews, returns, approves and pays them.", template: "tracker", tags: ["time", "invoicing"] } },
  { op: "setLook", args: { theme: "plain", appearance: "light" } },
  { op: "setShell", args: { frame: "top-nav" } },
  { op: "addRole", args: { id: "employee", name: "Employee", description: "Bills their own time and expenses" } },
  { op: "addRole", args: { id: "ap", name: "Accounts payable", description: "Reviews, approves and pays invoices; keeps the organization's projects" } },
  { op: "removeRole", args: { id: "member" } },
  { op: "addRecord", args: { id: "person", title: "Person", description: "Someone who bills time, or works in accounts payable", fields: [{ name: "name", title: "Name" }, { name: "email", type: "email", required: false }, { name: "calendar_connected", type: "boolean", title: "Calendar connected" }] } },
  { op: "addRecord", args: { id: "project", title: "Project", description: "Work that can be billed: kept by the organization, or an employee's own", fields: [{ name: "name", title: "Project" }, { name: "retired", type: "boolean" }, { name: "colour", type: "integer" }] } },
  { op: "addRelationship", args: { from: "project", to: "person", field: "owner_id", required: false, description: "The employee who owns a personal project; empty for organization projects" } },
  { op: "addRecord", args: { id: "rate", title: "Rate", description: "One employee's hourly rate on one project", fields: [{ name: "hourly_rate", type: "money", title: "Rate per hour" }] } },
  { op: "addRelationship", args: { from: "rate", to: "person", field: "person_id" } },
  { op: "addRelationship", args: { from: "rate", to: "project", field: "project_id" } },
  { op: "addRecord", args: { id: "invoice", title: "Invoice", description: "An employee's bill to accounts payable", fields: [
    { name: "number", required: false }, { name: "name", title: "Invoice" },
    { name: "status", type: "choice", values: ["draft", "submitted", "returned", "approved", "paid"] },
    { name: "submitted_on", type: "date", required: false, title: "Submitted" }, { name: "approved_on", type: "date", required: false, title: "Approved" },
    { name: "paid_on", type: "date", required: false, title: "Paid" }, { name: "return_reason", type: "longtext", required: false, title: "Reason" },
  ] } },
  { op: "addRelationship", args: { from: "invoice", to: "person", field: "person_id" } },
  { op: "addRecord", args: { id: "event", title: "Calendar event", description: "Time from the employee's calendar, or an entry added by hand; on an invoice it is a line", fields: [
    { name: "title" }, { name: "starts_at", type: "datetime", title: "Start" }, { name: "ends_at", type: "datetime", required: false, title: "End" },
    { name: "location", required: false }, { name: "description", type: "longtext", required: false, title: "Description in Google Calendar" },
    { name: "notes", type: "longtext", required: false, title: "What I accomplished" }, { name: "hours_override", type: "hours", required: false, title: "Hours" },
    { name: "manual", type: "boolean" }, { name: "all_day", type: "boolean" }, { name: "declined", type: "boolean" },
  ] } },
  { op: "addRelationship", args: { from: "event", to: "person", field: "person_id" } },
  { op: "addRelationship", args: { from: "event", to: "project", field: "project_id", required: false } },
  { op: "addRelationship", args: { from: "event", to: "invoice", field: "invoice_id", required: false, description: "The invoice that bills this time" } },
  { op: "addRecord", args: { id: "expense", title: "Expense", description: "An expense on an invoice, with its receipt", fields: [
    { name: "spent_on", type: "date", title: "Date" }, { name: "category", type: "choice", values: ["Travel", "Meals", "Parking", "Supplies", "Other"] },
    { name: "description", title: "What it was for" }, { name: "amount", type: "money", title: "Amount (US dollars)" }, { name: "receipt", required: false },
  ] } },
  { op: "addRelationship", args: { from: "expense", to: "invoice", field: "invoice_id" } },
];

/* ---------- batch 2: what the app works out ---------- */
const relInvoice = { first: [{ related: "event_invoice_id" }] };
const derived = [
  { op: "addDerived", args: { record: "event", name: "hours", type: "hours", expression: { round: [{ coalesce: [v("row.hours_override"), { hours: [v("row.starts_at"), v("row.ends_at")] }] }, 2] } } },
  { op: "addDerived", args: { record: "event", name: "day", type: "date", expression: { date: v("row.starts_at") } } },
  { op: "addDerived", args: { record: "event", name: "project_name", type: "text", title: "Project", expression: { first: [{ map: [{ related: "event_project_id" }, v("row.name")] }] } } },
  { op: "addDerived", args: { record: "event", name: "rate", type: "money", expression: { sum: [{ rows: ["rate", and(eq(v("row.person_id"), v("outer.person_id")), eq(v("row.project_id"), v("outer.project_id")))] }, "hourly_rate"] } } },
  { op: "addDerived", args: { record: "event", name: "amount", type: "money", expression: { round: [{ "*": [v("row.hours"), v("row.rate")] }, 2] } } },
  { op: "addDerived", args: { record: "event", name: "invoice_status", type: "text", expression: { first: [{ map: [{ related: "event_invoice_id" }, v("row.status")] }] } } },
  { op: "addDerived", args: { record: "event", name: "invoice_name", type: "text", expression: { first: [{ map: [{ related: "event_invoice_id" }, v("row.name")] }] } } },
  { op: "addDerived", args: { record: "event", name: "shown", type: "boolean", expression: and(not(v("row.all_day")), not(v("row.declined"))) } },
  { op: "addDerived", args: { record: "event", name: "happened", type: "boolean", expression: { "<=": [v("row.day"), today] } } },
  { op: "addDerived", args: { record: "event", name: "billed", type: "boolean", expression: { in: [v("row.invoice_status"), ["submitted", "approved", "paid"]] } } },
  { op: "addDerived", args: { record: "event", name: "state", type: "text", title: "Status", expression: {
    if: [not(v("row.happened")), "Later", { if: [v("row.billed"), "Billed", { if: [present(v("row.invoice_id")), { cat: ["On ", v("row.invoice_name")] }, { if: [present(v("row.project_id")), { cat: ["Saved under ", v("row.project_name")] }, "Unbilled"] }] }] }],
  } } },
  { op: "addDerived", args: { record: "event", name: "on_own_project", type: "boolean", expression: { some: [{ related: "event_project_id" }, present(v("row.owner_id"))] } } },
  { op: "addDerived", args: { record: "invoice", name: "employee_name", type: "text", title: "Employee", expression: { first: [{ map: [{ related: "invoice_person_id" }, v("row.name")] }] } } },
  { op: "addDerived", args: { record: "invoice", name: "employee_email", type: "text", expression: { first: [{ map: [{ related: "invoice_person_id" }, v("row.email")] }] } } },
  { op: "addDerived", args: { record: "invoice", name: "hours", type: "hours", expression: { round: [{ sum: [{ related: "event_invoice_id" }, "hours"] }, 2] } } },
  { op: "addDerived", args: { record: "invoice", name: "time_total", type: "money", title: "Time", expression: { round: [{ sum: [{ related: "event_invoice_id" }, "amount"] }, 2] } } },
  { op: "addDerived", args: { record: "invoice", name: "expense_total", type: "money", title: "Expenses", expression: { round: [{ sum: [{ related: "expense_invoice_id" }, "amount"] }, 2] } } },
  { op: "addDerived", args: { record: "invoice", name: "total", type: "money", title: "Total", expression: { round: [{ "+": [v("row.time_total"), v("row.expense_total")] }, 2] } } },
  { op: "addDerived", args: { record: "invoice", name: "period_start", type: "date", expression: { min: [[{ min: [{ related: "event_invoice_id" }, "day"] }, { min: [{ related: "expense_invoice_id" }, "spent_on"] }]] } } },
  { op: "addDerived", args: { record: "invoice", name: "period_end", type: "date", expression: { max: [[{ max: [{ related: "event_invoice_id" }, "day"] }, { max: [{ related: "expense_invoice_id" }, "spent_on"] }]] } } },
  { op: "addDerived", args: { record: "invoice", name: "period", type: "text", title: "Period", expression: {
    if: [present(v("row.period_start")), { if: [eq(v("row.period_start"), v("row.period_end")), { "short-date": v("row.period_start") }, { cat: [{ "short-date": v("row.period_start") }, " – ", { "short-date": v("row.period_end") }] }] }, "No dates yet"],
  } } },
  { op: "addDerived", args: { record: "invoice", name: "label", type: "text", title: "Invoice", expression: { if: [present(v("row.number")), { cat: [v("row.number"), " · ", v("row.name")] }, v("row.name")] } } },
  { op: "addDerived", args: { record: "invoice", name: "missing_receipts", type: "integer", expression: { count: [{ related: ["expense_invoice_id", not(present(v("row.receipt")))] }] } } },
  { op: "addDerived", args: { record: "invoice", name: "receipts_needed", type: "text", expression: { cat: ["Add the receipt for ", { join: [{ map: [{ related: ["expense_invoice_id", not(present(v("row.receipt")))] }, { cat: [v("row.description"), ", ", { "short-date": v("row.spent_on") }] }] }, " and "] }, " before submitting."] } } },
  { op: "addDerived", args: { record: "invoice", name: "is_empty", type: "boolean", expression: eq({ "+": [{ count: [{ related: "event_invoice_id" }] }, { count: [{ related: "expense_invoice_id" }] }] }, 0) } },
  { op: "addDerived", args: { record: "invoice", name: "is_mine", type: "boolean", expression: mine } },
  { op: "addDerived", args: { record: "invoice", name: "last_change", type: "text", title: "Last change", expression: {
    if: [eq(v("row.status"), "returned"), "Returned to you", { if: [eq(v("row.status"), "draft"), "Draft", { if: [eq(v("row.status"), "submitted"), { cat: ["Submitted ", { "short-date": v("row.submitted_on") }] }, { if: [eq(v("row.status"), "approved"), { cat: ["Approved ", { "short-date": v("row.approved_on") }] }, { cat: ["Paid ", { "short-date": v("row.paid_on") }] }] }] }] }],
  } } },
  { op: "addDerived", args: { record: "invoice", name: "sort_rank", type: "integer", expression: { if: [eq(v("row.status"), "returned"), 0, { if: [eq(v("row.status"), "draft"), 1, { if: [eq(v("row.status"), "submitted"), 2, { if: [eq(v("row.status"), "approved"), 3, 4] }] }] }] } } },
  { op: "addDerived", args: { record: "invoice", name: "review_note", type: "text", title: "Note", expression: { if: [v("row.is_mine"), "Your own: another reviewer decides", { if: [{ some: [{ related: "event_invoice_id" }, v("row.on_own_project")] }, "Has lines on the employee’s own project", ""] }] } } },
  { op: "addDerived", args: { record: "invoice", name: "employee_label", type: "text", title: "Employee", expression: { cat: [v("row.employee_name"), { if: [v("row.is_mine"), " (you)", ""] }] } } },
  { op: "addDerived", args: { record: "project", name: "kept_by", type: "text", title: "Kept by", expression: { if: [present(v("row.owner_id")), "You", "Organization"] } } },
  { op: "addDerived", args: { record: "project", name: "my_rate", type: "money", title: "Your rate ($/h)", expression: { first: [{ map: [{ rows: ["rate", and(eq(v("row.project_id"), v("outer.id")), eq(v("row.person_id"), v("user.key")))] }, v("row.hourly_rate")] }] } } },
  { op: "addDerived", args: { record: "project", name: "my_rate_id", type: "text", expression: { first: [{ map: [{ rows: ["rate", and(eq(v("row.project_id"), v("outer.id")), eq(v("row.person_id"), v("user.key")))] }, v("row.id")] }] } } },
  { op: "addDerived", args: { record: "project", name: "invoices_used", type: "integer", expression: { count: [{ distinct: [{ map: [{ related: ["event_project_id", and(eq(v("row.person_id"), v("user.key")), present(v("row.invoice_id")))] }, v("row.invoice_id")] }] }] } } },
  { op: "addDerived", args: { record: "project", name: "used_on_invoices", type: "text", title: "Used on invoices", expression: { if: [eq(v("row.invoices_used"), 0), "None", { if: [eq(v("row.invoices_used"), 1), "1 invoice", { cat: [v("row.invoices_used"), " invoices"] }] }] } } },
  { op: "addDerived", args: { record: "project", name: "employees_billing", type: "integer", title: "Employees billing it", expression: { count: [{ distinct: [{ map: [{ related: "event_project_id" }, v("row.person_id")] }] }] } } },
  { op: "addDerived", args: { record: "project", name: "status_label", type: "text", title: "Status", expression: { if: [v("row.retired"), "Retired", "Active"] } } },
];

/* ---------- batch 3: who sees what ---------- */
const access = [
  { op: "addAccess", args: { id: "project-employee", record: "project", roles: ["employee"], when: and(not(v("row.retired")), or(not(present(v("row.owner_id"))), eq(v("row.owner_id"), v("user.key")))), description: "Employees see active organization projects and their own" } },
  { op: "addAccess", args: { id: "project-ap", record: "project", roles: ["ap"], when: not(present(v("row.owner_id"))), description: "Accounts payable sees organization projects" } },
  { op: "addAccess", args: { id: "rate-employee", record: "rate", roles: ["employee"], when: mine, description: "Employees see only their own rates" } },
  { op: "addAccess", args: { id: "event-employee", record: "event", roles: ["employee"], when: and(mine, v("row.shown"), or(v("user.row.calendar_connected"), v("row.manual"))), description: "Employees see their own timed, accepted events once their calendar is connected, and their entries by hand" } },
  { op: "addAccess", args: { id: "event-ap", record: "event", roles: ["ap"], when: and(present(v("row.invoice_id")), { "!=": [v("row.invoice_status"), "draft"] }), description: "Accounts payable sees the time on submitted and decided invoices" } },
  { op: "addAccess", args: { id: "invoice-employee", record: "invoice", roles: ["employee"], when: mine, description: "Employees see only their own invoices" } },
  { op: "addAccess", args: { id: "invoice-ap", record: "invoice", roles: ["ap"], when: { "!=": [v("row.status"), "draft"] }, description: "Accounts payable never sees drafts" } },
  { op: "addAccess", args: { id: "expense-employee", record: "expense", roles: ["employee"], when: { some: [{ related: "expense_invoice_id" }, mine] }, description: "Employees see expenses on their own invoices" } },
  { op: "addAccess", args: { id: "expense-ap", record: "expense", roles: ["ap"], when: { some: [{ related: "expense_invoice_id" }, { "!=": [v("row.status"), "draft"] }] }, description: "Accounts payable sees expenses on submitted and decided invoices" } },
];

/* ---------- batch 4: what people can do ---------- */
const targetInvoice = (status) => ({ in: [v("params.target.status"), status] });
const notOwn = { "!=": [v("params.target.person_id"), v("user.key")] };
const myEditableInvoice = (idVar) => ({ some: [{ rows: ["invoice"] }, and(eq(v("row.id"), v(idVar)), eq(v("row.person_id"), v("user.key")), editable(v("row.status")))] });
const haveRate = (projectVar) => ({ some: [{ rows: ["rate"] }, and(eq(v("row.person_id"), v("user.key")), eq(v("row.project_id"), v(projectVar)))] });
const actions = [
  { op: "addAction", args: { id: "connect-calendar", name: "Connect Google Calendar", record: "person", kind: "update", set: { calendar_connected: true }, roles: ["employee"], preconditions: [{ id: "own-calendar", when: eq(v("params.target.id"), v("user.key")), message: "You can only connect your own calendar." }] } },
  { op: "addAction", args: { id: "add-to-invoice", name: "Add to invoice", record: "event", kind: "update", inputs: ["project_id", "invoice_id", "notes", "hours_override"], optional: ["notes", "hours_override"], roles: ["employee"], preconditions: [
    { id: "has-happened", when: v("params.target.happened"), message: "You can add this to an invoice once it has happened." },
    { id: "not-billed", when: not(v("params.target.billed")), message: "Already billed: it can’t be changed or added to another invoice." },
    { id: "choose-project", when: present(v("params.project_id")), message: "Choose a project to add this to the invoice." },
    { id: "positive-hours", when: or(not(present(v("params.hours_override"))), { ">": [v("params.hours_override"), 0] }), message: "Enter the hours, more than 0." },
    { id: "rate-set", when: haveRate("params.project_id"), message: "Set your rate for this project on Projects first." },
    { id: "own-draft", when: myEditableInvoice("params.invoice_id"), message: "Choose one of your draft or returned invoices." },
  ] } },
  { op: "addAction", args: { id: "save-event", name: "Save event", record: "event", kind: "update", inputs: ["project_id", "notes", "hours_override"], optional: ["project_id", "notes", "hours_override"], roles: ["employee"], preconditions: [
    { id: "not-billed", when: not(v("params.target.billed")), message: "Already billed: it can’t be changed or added to another invoice." },
    { id: "has-happened", when: v("params.target.happened"), message: "You can change this once it has happened." },
  ] } },
  { op: "addAction", args: { id: "remove-from-invoice", name: "Remove from invoice", record: "event", kind: "update", set: { invoice_id: null }, roles: ["employee"], preconditions: [{ id: "on-editable", when: editable(v("params.target.invoice_status")), message: "Only time on a draft or returned invoice can be removed." }] } },
  { op: "addAction", args: { id: "add-entry", name: "Add entry", description: "Adds time by hand", record: "event", kind: "create", inputs: ["person_id", "title", "starts_at", "hours_override", "project_id", "invoice_id"], optional: ["invoice_id"], set: { manual: true, all_day: false, declined: false }, roles: ["employee"], preconditions: [
    { id: "own-entry", when: eq(v("params.person_id"), v("user.key")), message: "You can only add your own time." },
    { id: "not-future", when: { "<=": [{ date: v("params.starts_at") }, today] }, message: "Entries can’t be dated after today." },
    { id: "positive-hours", when: { ">": [v("params.hours_override"), 0] }, message: "Enter the hours, more than 0." },
    { id: "rate-set", when: haveRate("params.project_id"), message: "Set your rate for this project on Projects first." },
    { id: "own-draft", when: or(not(present(v("params.invoice_id"))), myEditableInvoice("params.invoice_id")), message: "Choose one of your draft or returned invoices." },
  ] } },
  { op: "addAction", args: { id: "new-invoice", name: "New invoice", record: "invoice", kind: "create", inputs: ["person_id", "name"], set: { status: "draft" }, roles: ["employee"], preconditions: [{ id: "own-invoice", when: eq(v("params.person_id"), v("user.key")), message: "You can only start your own invoices." }] } },
  { op: "addAction", args: { id: "add-expense", name: "Add expense", record: "expense", kind: "create", inputs: ["invoice_id", "spent_on", "amount", "category", "description", "receipt"], optional: ["receipt"], roles: ["employee"], preconditions: [
    { id: "not-future", when: { "<=": [v("params.spent_on"), today] }, message: "Expenses can’t be dated after today." },
    { id: "positive-amount", when: { ">": [v("params.amount"), 0] }, message: "Enter the amount, for example 42.50." },
    { id: "own-draft", when: myEditableInvoice("params.invoice_id"), message: "Expenses can only be added to your draft or returned invoices." },
  ] } },
  { op: "addAction", args: { id: "remove-expense", name: "Remove expense", record: "expense", kind: "delete", roles: ["employee"], preconditions: [{ id: "on-editable", when: { some: [{ rows: ["invoice"] }, and(eq(v("row.id"), v("params.target.invoice_id")), editable(v("row.status")))] }, message: "Expenses can only be removed from draft or returned invoices." }] } },
  { op: "addAction", args: { id: "submit-invoice", name: "Submit to accounts payable", record: "invoice", kind: "update", inputs: ["submitted_on"], set: { status: "submitted" }, roles: ["employee"], preconditions: [
    { id: "own-invoice", when: eq(v("params.target.person_id"), v("user.key")), message: "You can only submit your own invoices." },
    { id: "can-submit", when: targetInvoice(["draft", "returned"]), message: "Only drafts and returned invoices can be submitted." },
    { id: "not-empty", when: not(v("params.target.is_empty")), message: "This invoice is empty: add time from Time, or an expense, before submitting." },
    { id: "receipts", when: eq(v("params.target.missing_receipts"), 0), message: "Add the receipt for every expense before submitting." },
  ] } },
  { op: "addAction", args: { id: "withdraw-invoice", name: "Withdraw", record: "invoice", kind: "update", set: { status: "draft" }, roles: ["employee"], preconditions: [
    { id: "own-invoice", when: eq(v("params.target.person_id"), v("user.key")), message: "You can only withdraw your own invoices." },
    { id: "is-submitted", when: targetInvoice(["submitted"]), message: "Only submitted invoices can be withdrawn." },
  ] } },
  { op: "addAction", args: { id: "delete-draft", name: "Delete draft", record: "invoice", kind: "delete", roles: ["employee"], preconditions: [
    { id: "is-draft", when: targetInvoice(["draft"]), message: "Only drafts can be deleted." },
    { id: "is-empty", when: v("params.target.is_empty"), message: "Remove its time and expenses first: only an empty draft can be deleted." },
  ] } },
  { op: "addAction", args: { id: "set-my-rate", name: "Change my rate", record: "rate", kind: "update", inputs: ["hourly_rate"], roles: ["employee"], preconditions: [
    { id: "own-rate", when: eq(v("params.target.person_id"), v("user.key")), message: "You can only change your own rate." },
    { id: "positive-rate", when: { ">": [v("params.hourly_rate"), 0] }, message: "Enter a rate above 0." },
  ] } },
  { op: "addAction", args: { id: "add-my-rate", name: "Set my rate", record: "rate", kind: "create", inputs: ["person_id", "project_id", "hourly_rate"], roles: ["employee"], preconditions: [
    { id: "own-rate", when: eq(v("params.person_id"), v("user.key")), message: "You can only set your own rate." },
    { id: "positive-rate", when: { ">": [v("params.hourly_rate"), 0] }, message: "Enter a rate above 0." },
    { id: "no-rate-yet", when: not(haveRate("params.project_id")), message: "You already have a rate for this project; change it instead." },
  ] } },
  { op: "addAction", args: { id: "add-own-project", name: "Add my own project", record: "project", kind: "create", inputs: ["name", "owner_id"], set: { retired: false, colour: 3 }, roles: ["employee"], preconditions: [
    { id: "named", when: present(v("params.name")), message: "Enter the project’s name." },
    { id: "own-project", when: eq(v("params.owner_id"), v("user.key")), message: "You can only add your own projects." },
  ] } },
  { op: "addAction", args: { id: "rename-own-project", name: "Rename my project", record: "project", kind: "update", inputs: ["name"], roles: ["employee"], preconditions: [
    { id: "own-project", when: eq(v("params.target.owner_id"), v("user.key")), message: "Organization projects are kept by accounts payable." },
    { id: "named", when: present(v("params.name")), message: "Enter the new name." },
  ] } },
  { op: "addAction", args: { id: "remove-own-project", name: "Remove my project", record: "project", kind: "delete", roles: ["employee"], preconditions: [
    { id: "own-project", when: eq(v("params.target.owner_id"), v("user.key")), message: "Organization projects are kept by accounts payable." },
    { id: "unused", when: not({ some: [{ rows: ["event"] }, eq(v("row.project_id"), v("params.target.id"))] }), message: "This project has time on it; move that time to another project first." },
    { id: "no-rates", when: not({ some: [{ rows: ["rate"] }, eq(v("row.project_id"), v("params.target.id"))] }), message: "Remove your rate for this project first." },
  ] } },
  { op: "addAction", args: { id: "approve-invoice", name: "Approve", record: "invoice", kind: "update", inputs: ["approved_on"], set: { status: "approved" }, roles: ["ap"], preconditions: [
    { id: "is-submitted", when: targetInvoice(["submitted"]), message: "Only submitted invoices can be approved." },
    { id: "not-own", when: notOwn, message: "You submitted this invoice: another accounts payable staff member must approve or return it." },
  ] } },
  { op: "addAction", args: { id: "return-invoice", name: "Return to employee", record: "invoice", kind: "update", inputs: ["return_reason"], optional: ["return_reason"], set: { status: "returned" }, roles: ["ap"], preconditions: [
    { id: "is-submitted", when: targetInvoice(["submitted"]), message: "Only submitted invoices can be returned." },
    { id: "not-own", when: notOwn, message: "You submitted this invoice: another accounts payable staff member must approve or return it." },
    { id: "has-reason", when: present(v("params.return_reason")), message: "Say what the employee needs to fix." },
  ] } },
  { op: "addAction", args: { id: "mark-paid", name: "Mark paid", record: "invoice", kind: "update", inputs: ["paid_on"], optional: ["paid_on"], set: { status: "paid" }, roles: ["ap"], preconditions: [
    { id: "is-approved", when: targetInvoice(["approved"]), message: "Only approved invoices can be marked paid." },
    { id: "not-own", when: notOwn, message: "You can’t mark your own invoice paid: another accounts payable staff member does." },
    { id: "has-date", when: present(v("params.paid_on")), message: "Choose the payment date." },
    { id: "after-approval", when: { ">=": [v("params.paid_on"), v("params.target.approved_on")] }, message: "The payment date can’t be before the approval date." },
    { id: "not-future", when: { "<=": [v("params.paid_on"), today] }, message: "The payment date can’t be in the future." },
  ] } },
  { op: "addAction", args: { id: "add-org-project", name: "Add project", record: "project", kind: "create", inputs: ["name"], set: { retired: false, colour: 2 }, roles: ["ap"], preconditions: [
    { id: "named", when: present(v("params.name")), message: "Enter the project’s name." },
    { id: "unique", when: not({ some: [{ rows: ["project"] }, eq({ lower: v("row.name") }, { lower: v("params.name") })] }), message: "There is already a project with that name." },
  ] } },
  { op: "addAction", args: { id: "rename-org-project", name: "Rename organization project", record: "project", kind: "update", inputs: ["name"], roles: ["ap"], preconditions: [
    { id: "org-project", when: not(present(v("params.target.owner_id"))), message: "Only organization projects are kept by accounts payable." },
    { id: "named", when: present(v("params.name")), message: "Enter the project’s name." },
    { id: "unique", when: not({ some: [{ rows: ["project"] }, and(eq({ lower: v("row.name") }, { lower: v("params.name") }), { "!=": [v("row.id"), v("params.target.id")] })] }), message: "There is already a project with that name." },
  ] } },
  { op: "addAction", args: { id: "retire-project", name: "Retire project", record: "project", kind: "update", set: { retired: true }, roles: ["ap"], preconditions: [{ id: "is-active", when: not(v("params.target.retired")), message: "This project is already retired." }] } },
  { op: "addAction", args: { id: "restore-project", name: "Restore project", record: "project", kind: "update", set: { retired: false }, roles: ["ap"], preconditions: [{ id: "is-retired", when: v("params.target.retired"), message: "This project is active." }] } },
];

/* ---------- batch 5: the screens ---------- */
const bindRow = [{ parameter: "target", from: "row" }];
const bindParam = [{ parameter: "target", from: "param" }];
const todayValue = (parameter) => ({ parameter, from: "value", value: rule(today) });
const projectOptions = { record: R("project"), label: F("project", "name") };
const myInvoices = { record: R("invoice"), label: F("invoice", "name"), filter: rule(and(eq(v("row.person_id"), v("user.key")), editable(v("row.status")))) };
const invoiceColumns = (who) => [
  ...(who === "ap" ? [{ derived: "invoice_employee_label", label: "Employee", link: { screen: "ap-invoice", param: rule(v("row.id")) }, priority: true }] : []),
  ...(who === "employee" ? [{ field: F("invoice", "status"), label: "Status", format: "status", status: STATUS, priority: true }] : []),
  who === "employee"
    ? { derived: "invoice_label", label: "Invoice", link: { screen: "invoice", param: rule(v("row.id")) }, secondary: rule({ if: [present(v("row.return_reason")), { cat: ["“", v("row.return_reason"), "”"] }, ""] }), priority: true }
    : { field: F("invoice", "number"), label: "Invoice", priority: true },
  { derived: "invoice_period", label: "Period" },
  { derived: "invoice_total", label: "Total", format: "currency", numeric: true, priority: true },
];
const documentSections = (editableRows) => [
  { id: "parties", title: rule({ if: [present(v("record.number")), { cat: ["Invoice ", v("record.number")] }, "Invoice"] }), fields: [
    { derived: "invoice_employee_name", label: "From" },
    { derived: "invoice_employee_email", label: "Email" },
    { value: rule("Accounts payable · Example Organization"), label: "To" },
    { derived: "invoice_period", label: "Period" },
    { field: F("invoice", "status"), label: "Status", format: "status", status: STATUS },
  ] },
  { id: "time", title: "Time", relationship: "event_invoice_id", columns: [
    { derived: "event_day", label: "Date", format: "date" },
    { field: F("event", "title"), label: "Work", secondary: rule({ cat: [{ if: [v("row.manual"), "Manual · ", ""] }, { coalesce: [v("row.notes"), ""] }] }) },
    { derived: "event_project_name", label: "Project" },
    { derived: "event_hours", label: "Hours", format: "hours", numeric: true },
    { derived: "event_amount", label: "Amount", format: "currency", numeric: true },
  ], ...(editableRows ? { rowActions: [{ action: "remove-from-invoice", label: "Remove", emphasis: "text", bind: bindRow, when: rule(editable(v("record.status"))), roles: ["employee"], success: { toast: rule({ cat: [v("row.title"), " removed from the invoice. Its project and notes are kept."] }) } }] } : {}), empty: "No time on this invoice yet. Add events from Time." },
  { id: "expenses", title: "Expenses", relationship: "expense_invoice_id", columns: [
    { field: F("expense", "spent_on"), label: "Date", format: "date" },
    { value: rule({ cat: [v("row.category"), " · ", v("row.description")] }), label: "Expense" },
    { value: rule({ coalesce: [v("row.receipt"), "Receipt needed"] }), label: "Receipt" },
    { field: F("expense", "amount"), label: "Amount", format: "currency", numeric: true },
  ], ...(editableRows ? { rowActions: [{ action: "remove-expense", label: "Remove", emphasis: "destructive", bind: bindRow, when: rule(editable(v("record.status"))), roles: ["employee"], confirm: { title: rule({ cat: ["Remove expense ", v("row.description"), "?"] }), message: "It is taken off this invoice.", confirmLabel: "Remove" }, success: { toast: rule({ cat: ["Expense ", v("row.description"), " removed."] }) } }] } : {}), empty: "No expenses." },
  { id: "totals", title: "Totals", totals: [
    { derived: "invoice_hours", label: "Hours", format: "hours" },
    { derived: "invoice_time_total", label: "Time", format: "currency" },
    { derived: "invoice_expense_total", label: "Expenses", format: "currency" },
    { derived: "invoice_total", label: "Total", format: "currency" },
  ] },
];
const notice = (id, tone, title, message, when) => ({ id, kind: "notice", tone, title, message, when: rule(when) });
const recStatus = (s) => eq(v("record.status"), s);

const screens = [
  { op: "removeScreen", args: { id: "home" } },
  { op: "putScreen", args: {
    id: "time", title: "Time", pattern: "schedule", roles: ["employee"],
    description: "Your calendar, week by week. Choose an event to save it under a project or add it to an invoice. Last synced with Google Calendar at 08:12.",
    actions: [
      { action: "add-entry", label: "Add entry by hand", emphasis: "secondary", bind: [{ parameter: "person_id", from: "user" }], inputs: [
        { parameter: "starts_at", label: "Date", control: "datetime", default: rule({ cat: [today, "T09:00:00Z"] }) },
        { parameter: "hours_override", label: "Hours", control: "hours" },
        { parameter: "project_id", label: "Project", control: "select", options: projectOptions },
        { parameter: "title", label: "What I accomplished", control: "textarea" },
        { parameter: "invoice_id", label: "Invoice", control: "select", options: myInvoices, hint: "Leave empty to keep it off invoices for now" },
      ], success: { toast: "Entry added." } },
      { action: "new-invoice", label: "New invoice", emphasis: "primary", bind: [{ parameter: "person_id", from: "user" }], inputs: [{ parameter: "name", label: "Name", default: rule({ cat: ["New invoice · ", { "short-date": today }] }) }], success: { toast: "New draft started. Add events to it from Time." } },
    ],
    regions: [
      { id: "connect", kind: "notice", tone: "info", title: "Connect your Google Calendar", message: "Read-only access. Your timed events appear here as unbilled time; nothing is written to your calendar.", when: rule(not(v("user.row.calendar_connected"))) },
      { id: "connect-action", kind: "actions", when: rule(not(v("user.row.calendar_connected"))), items: [{ action: "connect-calendar", label: "Connect Google Calendar", emphasis: "primary", bind: [{ parameter: "target", from: "user" }], success: { toast: "Calendar connected." } }] },
      { id: "week", kind: "stats", tiles: [
        { label: "Unbilled this week", format: "hours", value: rule({ sum: [{ rows: ["event", and(eq({ "start-of-week": v("row.day") }, { "start-of-week": today }), v("row.happened"), not(present(v("row.invoice_id"))))] }, "hours"] }) },
        { label: "On draft invoices", format: "hours", value: rule({ sum: [{ rows: ["event", editable(v("row.invoice_status"))] }, "hours"] }) },
        { label: "Drafts total", format: "currency", value: rule({ sum: [{ rows: ["invoice", editable(v("row.status"))] }, "total"] }) },
      ] },
      { id: "calendar", kind: "schedule", record: R("event"), start: F("event", "starts_at"), end: F("event", "ends_at"), label: { field: F("event", "title") }, detail: { derived: "event_state" }, colorBy: { derived: "event_project_name" }, hours: { from: 8, to: 18 },
        legend: [{ label: "Colour: the event's project" }, { label: "“Later”: not yet happened" }, { label: "Billed: on a submitted or decided invoice" }],
        eventActions: [
          { action: "add-to-invoice", label: "Add to invoice", emphasis: "primary", bind: bindRow, when: rule(and(v("row.happened"), not(v("row.billed")))), inputs: [
            { parameter: "project_id", label: "Project", control: "select", options: projectOptions, default: rule(v("row.project_id")) },
            { parameter: "invoice_id", label: "Invoice", control: "select", options: myInvoices, default: rule(v("row.invoice_id")) },
            { parameter: "notes", label: "What I accomplished", control: "textarea", hint: "Shows on the invoice line. Your calendar is not changed.", default: rule({ coalesce: [v("row.notes"), v("row.description")] }) },
            { parameter: "hours_override", label: "Hours", control: "hours", default: rule(v("row.hours")) },
          ], success: { toast: rule({ cat: [v("row.title"), " added to the invoice."] }) } },
          { action: "save-event", label: "Save without invoicing", emphasis: "secondary", bind: bindRow, when: rule(and(v("row.happened"), not(v("row.billed")))), inputs: [
            { parameter: "project_id", label: "Project", control: "select", options: projectOptions, default: rule(v("row.project_id")) },
            { parameter: "notes", label: "What I accomplished", control: "textarea", default: rule({ coalesce: [v("row.notes"), v("row.description")] }) },
            { parameter: "hours_override", label: "Hours", control: "hours", default: rule(v("row.hours")) },
          ], success: { toast: rule({ cat: [v("row.title"), " saved. It is not on an invoice yet."] }) } },
          { action: "remove-from-invoice", label: "Remove from invoice", emphasis: "text", bind: bindRow, when: rule(and(present(v("row.invoice_id")), editable(v("row.invoice_status")))), success: { toast: rule({ cat: [v("row.title"), " removed from the invoice. Its project and notes are kept."] }) } },
        ],
        empty: { title: "Nothing in your calendar this week", message: "Timed events from your calendar appear here. Add time by hand if you need to." } },
    ],
  } },
  { op: "putScreen", args: {
    id: "invoices", title: "My invoices", pattern: "collection", roles: ["employee"],
    actions: [{ action: "new-invoice", label: "New invoice", emphasis: "primary", bind: [{ parameter: "person_id", from: "user" }], inputs: [{ parameter: "name", label: "Name", default: rule({ cat: ["New invoice · ", { "short-date": today }] }) }], success: { toast: "New draft started. Add events to it from Time." } }],
    regions: [{ id: "list", kind: "collection", title: "My invoices, drafts and returned first", record: R("invoice"), sort: [{ by: { derived: "invoice_sort_rank" }, direction: "ascending" }],
      columns: [...invoiceColumns("employee"), { derived: "invoice_last_change", label: "Last change", priority: true }],
      empty: { title: "Nothing here yet", message: "When there is something to show, it will be listed here." } }],
  } },
  { op: "putScreen", args: {
    id: "invoice", title: rule(v("record.name")), description: rule({ if: [present(v("record.number")), { cat: ["Invoice ", v("record.number")] }, "Draft invoice"] }), pattern: "record", roles: ["employee"],
    param: { id: "invoice", record: R("invoice") }, back: { screen: "invoices" },
    regions: [
      notice("draft", "info", "Draft", "Only you can see this. Accounts payable receives it exactly as shown below.", recStatus("draft")),
      notice("receipts", "warning", "An expense needs its receipt", rule(v("record.receipts_needed")), and(editable(v("record.status")), { ">": [v("record.missing_receipts"), 0] })),
      notice("returned", "warning", "Returned by accounts payable", rule({ cat: [v("record.return_reason"), " Fix it and submit again."] }), recStatus("returned")),
      notice("submitted", "info", rule({ cat: ["Submitted ", { "short-date": v("record.submitted_on") }] }), "Waiting for accounts payable. You can withdraw it until it’s approved.", recStatus("submitted")),
      notice("approved", "success", rule({ cat: ["Approved ", { "short-date": v("record.approved_on") }] }), "Waiting for payment. It can no longer be changed.", recStatus("approved")),
      notice("paid", "success", rule({ cat: ["Paid on ", { "short-date": v("record.paid_on") }] }), "This invoice is closed and can’t be changed.", recStatus("paid")),
      { id: "document", kind: "document", sections: documentSections(true) },
      { id: "actions", kind: "actions", items: [
        { action: "submit-invoice", label: "Submit to accounts payable", emphasis: "primary", bind: [...bindParam, todayValue("submitted_on")], when: rule(recStatus("draft")), success: { toast: "Invoice submitted to accounts payable. You can withdraw it until it’s approved.", navigate: { screen: "invoices" } } },
        { action: "submit-invoice", label: "Submit again", emphasis: "primary", bind: [...bindParam, todayValue("submitted_on")], when: rule(recStatus("returned")), success: { toast: "Invoice submitted again.", navigate: { screen: "invoices" } } },
        { action: "add-expense", label: "Add expense", emphasis: "secondary", bind: [{ parameter: "invoice_id", from: "param" }], when: rule(editable(v("record.status"))), inputs: [
          { parameter: "spent_on", label: "Date", control: "date", default: rule(today) },
          { parameter: "amount", label: "Amount (US dollars)", control: "currency" },
          { parameter: "category", label: "Category", control: "select" },
          { parameter: "description", label: "What it was for" },
          { parameter: "receipt", label: "Receipt", control: "file", hint: "A photo or PDF. Needed before you submit." },
        ], success: { toast: "Expense added." } },
        { action: "withdraw-invoice", label: "Withdraw", emphasis: "secondary", bind: bindParam, when: rule(recStatus("submitted")), confirm: { title: "Withdraw this invoice?", message: "It goes back to draft and leaves accounts payable’s queue. You can change it and submit it again.", confirmLabel: "Withdraw" }, success: { toast: "Invoice withdrawn to draft." } },
        { action: "delete-draft", label: "Delete draft", emphasis: "destructive", bind: bindParam, when: rule(recStatus("draft")), confirm: { title: "Delete this draft?", message: "The draft is removed for good.", confirmLabel: "Delete draft" }, success: { toast: "Draft deleted.", navigate: { screen: "invoices" } } },
      ] },
    ],
  } },
  { op: "putScreen", args: {
    id: "projects", title: "Projects and rates", pattern: "collection", roles: ["employee"],
    actions: [{ action: "add-own-project", label: "Add my own project", emphasis: "secondary", bind: [{ parameter: "owner_id", from: "user" }], inputs: [{ parameter: "name", label: "Project name", hint: "Only you see your own projects; accounts payable sees them on your invoices." }], success: { toast: "Project added. Only you see it." } }],
    regions: [
      { id: "list", kind: "collection", title: "Projects you can bill, with your hourly rate", record: R("project"), sort: [{ by: { derived: "project_kept_by" }, direction: "ascending" }, { by: { field: F("project", "name") }, direction: "ascending" }],
        columns: [{ field: F("project", "name"), label: "Project", priority: true }, { derived: "project_kept_by", label: "Kept by" }, { derived: "project_my_rate", label: "Your rate ($/h)", format: "currency", numeric: true, priority: true }, { derived: "project_used_on_invoices", label: "Used on invoices" }],
        rowActions: [
          { action: "set-my-rate", label: "Change my rate", bind: [{ parameter: "target", from: "value", value: rule(v("row.my_rate_id")) }], when: rule(present(v("row.my_rate_id"))), inputs: [{ parameter: "hourly_rate", label: "Rate per hour (US dollars)", control: "currency", default: rule(v("row.my_rate")) }], success: { toast: "Rate saved. Submitted invoices keep their rates." } },
          { action: "add-my-rate", label: "Set my rate", bind: [{ parameter: "person_id", from: "user" }, { parameter: "project_id", from: "value", value: rule(v("row.id")) }], when: rule(not(present(v("row.my_rate_id")))), inputs: [{ parameter: "hourly_rate", label: "Rate per hour (US dollars)", control: "currency" }], success: { toast: "Rate saved." } },
          { action: "rename-own-project", label: "Rename", bind: bindRow, when: rule(eq(v("row.kept_by"), "You")), inputs: [{ parameter: "name", label: "New name", default: rule(v("row.name")) }], success: { toast: "Renamed. Submitted invoices keep the old name." } },
          { action: "remove-own-project", label: "Remove", emphasis: "destructive", bind: bindRow, when: rule(eq(v("row.kept_by"), "You")), confirm: { title: rule({ cat: ["Remove ", v("row.name"), "?"] }), message: "Only your own projects can be removed.", confirmLabel: "Remove" }, success: { toast: "Project removed." } },
        ],
        empty: { title: "No projects yet", message: "Accounts payable adds the organization’s projects; you can add your own." } },
      { id: "note", kind: "notice", tone: "info", title: "Organization projects are kept by accounts payable", message: "You can set your rate but not rename or remove them." },
    ],
  } },
  { op: "putScreen", args: {
    id: "review", title: "Invoices to review", pattern: "queue", roles: ["ap"],
    regions: [
      { id: "queue", kind: "collection", title: "Invoices waiting for a decision, oldest first", record: R("invoice"), filter: rule(eq(v("row.status"), "submitted")), sort: [{ by: { field: F("invoice", "submitted_on") }, direction: "ascending" }],
        columns: [...invoiceColumns("ap"), { field: F("invoice", "submitted_on"), label: "Submitted", format: "date" }, { derived: "invoice_review_note", label: "Note", priority: true }],
        rowActions: [
          { action: "approve-invoice", label: "Approve", bind: [...bindRow, todayValue("approved_on")], when: rule(not(v("row.is_mine"))), success: { toast: rule({ cat: [{ coalesce: [v("row.number"), v("row.name")] }, " approved."] }) } },
          { action: "return-invoice", label: "Return to employee", bind: bindRow, when: rule(not(v("row.is_mine"))), inputs: [{ parameter: "return_reason", label: "Reason", control: "textarea", hint: "The employee sees this with the invoice." }], success: { toast: rule({ cat: [{ coalesce: [v("row.number"), v("row.name")] }, " returned to ", v("row.employee_name"), " with your reason."] }) } },
        ],
        empty: { title: "Nothing waiting", message: "Every submitted invoice has a decision." } },
      { id: "own", kind: "notice", tone: "info", title: "Your own invoice is in the queue", message: "Another accounts payable staff member approves or returns it.", when: rule({ some: [{ rows: ["invoice"] }, and(eq(v("row.status"), "submitted"), v("row.is_mine"))] }) },
    ],
  } },
  { op: "putScreen", args: {
    id: "to-pay", title: "Invoices to pay", pattern: "queue", roles: ["ap"],
    regions: [{ id: "approved", kind: "collection", title: "Approved invoices waiting for payment", record: R("invoice"), filter: rule(eq(v("row.status"), "approved")), sort: [{ by: { field: F("invoice", "approved_on") }, direction: "ascending" }],
      columns: [...invoiceColumns("ap"), { field: F("invoice", "approved_on"), label: "Approved", format: "date" }],
      rowActions: [{ action: "mark-paid", label: "Mark paid", bind: bindRow, when: rule(not(v("row.is_mine"))), inputs: [{ parameter: "paid_on", label: "Payment date", control: "date", default: rule(today) }], success: { toast: rule({ cat: [{ coalesce: [v("row.number"), v("row.name")] }, " marked paid."] }) } }],
      empty: { title: "Nothing to pay", message: "Approved invoices appear here until they’re marked paid." } }],
  } },
  { op: "putScreen", args: {
    id: "ap-invoice", title: rule({ cat: [v("record.employee_name"), " · ", { coalesce: [v("record.number"), v("record.name")] }] }), description: rule({ cat: [v("record.name"), " · submitted ", { "short-date": v("record.submitted_on") }] }), pattern: "record", roles: ["ap"],
    param: { id: "invoice", record: R("invoice") }, back: { screen: "review" },
    regions: [
      notice("own", "info", "You submitted this invoice", "Another accounts payable staff member must approve or return it and mark it paid.", v("record.is_mine")),
      notice("approved", "success", rule({ cat: ["Approved ", { "short-date": v("record.approved_on") }] }), "Waiting for payment: mark it paid from To pay.", and(recStatus("approved"), not(v("record.is_mine")))),
      notice("returned", "warning", "Returned to the employee", rule(v("record.return_reason")), recStatus("returned")),
      notice("paid", "success", rule({ cat: ["Paid on ", { "short-date": v("record.paid_on") }] }), "Closed.", recStatus("paid")),
      { id: "document", kind: "document", sections: documentSections(false) },
      { id: "decide", kind: "actions", when: rule(not(v("record.is_mine"))), items: [
        { action: "approve-invoice", label: "Approve", emphasis: "primary", bind: [...bindParam, todayValue("approved_on")], when: rule(recStatus("submitted")), success: { toast: "Invoice approved.", navigate: { screen: "review" } } },
        { action: "return-invoice", label: "Return to employee", emphasis: "secondary", bind: bindParam, when: rule(recStatus("submitted")), inputs: [{ parameter: "return_reason", label: "Reason", control: "textarea", hint: "The employee sees this with the invoice." }], success: { toast: "Returned to the employee with your reason.", navigate: { screen: "review" } } },
        { action: "mark-paid", label: "Mark paid", emphasis: "primary", bind: bindParam, when: rule(recStatus("approved")), inputs: [{ parameter: "paid_on", label: "Payment date", control: "date", default: rule(today) }], success: { toast: "Marked paid.", navigate: { screen: "to-pay" } } },
      ] },
    ],
  } },
  { op: "putScreen", args: {
    id: "org-projects", title: "Organization projects", pattern: "collection", roles: ["ap"],
    actions: [{ action: "add-org-project", label: "Add project", emphasis: "primary", inputs: [{ parameter: "name", label: "Project name" }], success: { toast: "Project added: every employee can choose it now." } }],
    regions: [{ id: "list", kind: "collection", title: "Projects every employee can bill", record: R("project"), sort: [{ by: { field: F("project", "retired") }, direction: "ascending" }, { by: { field: F("project", "name") }, direction: "ascending" }],
      columns: [{ field: F("project", "name"), label: "Project", priority: true }, { derived: "project_status_label", label: "Status", format: "status", status: { Active: { tone: "live", label: "Active" }, Retired: { tone: "closed", label: "Retired" } } }, { derived: "project_employees_billing", label: "Employees billing it", numeric: true }],
      rowActions: [
        { action: "rename-org-project", label: "Rename", bind: bindRow, when: rule(not(v("row.retired"))), inputs: [{ parameter: "name", label: "Project name", default: rule(v("row.name")) }], success: { toast: "Renamed. Submitted invoices keep the old name." } },
        { action: "retire-project", label: "Retire", bind: bindRow, when: rule(not(v("row.retired"))), success: { toast: rule({ cat: [v("row.name"), " retired: employees can’t choose it for new time. Past invoices keep it."] }) } },
        { action: "restore-project", label: "Restore", bind: bindRow, when: rule(v("row.retired")), success: { toast: rule({ cat: [v("row.name"), " restored."] }) } },
      ],
      empty: { title: "No projects yet", message: "Add the projects every employee can bill." } }],
  } },
  { op: "setNavigation", args: {
    navigation: [
      { id: "time", label: "Time", icon: "calendar", screen: "time", roles: ["employee"] },
      { id: "invoices", label: "Invoices", icon: "view", screen: "invoices", roles: ["employee"] },
      { id: "projects", label: "Projects", icon: "settings", screen: "projects", roles: ["employee"] },
      { id: "review", label: rule({ cat: ["To review", { if: [{ ">": [{ count: [{ rows: ["invoice", and(eq(v("row.status"), "submitted"), not(v("row.is_mine")))] }] }, 0] }, { cat: [" (", { count: [{ rows: ["invoice", and(eq(v("row.status"), "submitted"), not(v("row.is_mine")))] }] }, ")"] }, ""] }] }), icon: "check-circle", screen: "review", roles: ["ap"] },
      { id: "to-pay", label: rule({ cat: ["To pay", { if: [{ ">": [{ count: [{ rows: ["invoice", and(eq(v("row.status"), "approved"), not(v("row.is_mine")))] }] }, 0] }, { cat: [" (", { count: [{ rows: ["invoice", and(eq(v("row.status"), "approved"), not(v("row.is_mine")))] }] }, ")"] }, ""] }] }), icon: "download", screen: "to-pay", roles: ["ap"] },
      { id: "org-projects", label: "Organization projects", icon: "settings", screen: "org-projects", roles: ["ap"] },
    ],
    home: [{ roles: ["employee"], screen: "time" }, { roles: ["ap"], screen: "review" }],
  } },
];

/* ---------- batch 6: sample data and people ---------- */
const samples = [
  ...["person", "project", "rate", "invoice", "event", "expense"].map((record) => ({ op: "setSamples", args: { record, rows: SAMPLES[record] } })),
  { op: "setIdentities", args: { record: "person", clock: "2026-11-12T12:00:00Z", identities: [
    { id: "priya", name: "Priya Shah", email: "priya.shah@example.org", roles: ["employee"], key: "priya" },
    { id: "sam", name: "Sam Lee", email: "sam.lee@example.org", roles: ["employee"], key: "sam", note: "Calendar not connected" },
    { id: "dana-employee", name: "Dana Ortiz", email: "dana.ortiz@example.org", roles: ["employee"], key: "dana", note: "Employee login" },
    { id: "dana-ap", name: "Dana Ortiz", email: "dana.ortiz@example.org", roles: ["ap"], key: "dana", note: "Accounts payable login" },
    { id: "morgan", name: "Morgan Reyes", roles: ["ap"], key: "morgan" },
  ] } },
];

const apply = (summary, operations) => ({ action: "app_apply_operations", input: { summary, operations } });

export const REQUEST = "I need a time tracking and invoicing app: employees log time from their calendar, put it on invoices with expenses and receipts, and submit them to accounts payable, who review, return or approve them and mark them paid.";

export const BUILD = {
  match: /time.?track|timesheet|invoic/i,
  app: { name: "Time tracker", description: "Employees bill their calendar time and expenses to accounts payable." },
  steps: [
    { say: "I'll create the app in your catalog, then design it in batches you can watch in the preview.", action: "catalog_create_app", input: { name: "Time tracker", useCase: REQUEST, description: "Employees bill their calendar time and expenses to accounts payable." } },
    { say: "First the two roles and the records: people, projects, rates, calendar events, invoices and expenses.", ...apply("Roles and records: people, projects, rates, calendar events, invoices, expenses", records) },
    { say: "Now what the app works out for itself: hours, amounts at each person's rate, totals, periods and status.", ...apply("Derived values: hours, amounts, totals, periods, status labels", derived) },
    { say: "Next, who sees what: employees see only their own time and invoices; accounts payable never sees drafts.", ...apply("Access: employees see their own; accounts payable sees submitted and decided invoices", access) },
    { say: "Then what each role can do, with the checks that stop mistakes (receipts before submitting, no approving your own invoice).", ...apply("Actions: billing time, invoices and expenses, rates, projects, review and payment", actions) },
    { say: "Now the screens: a week calendar, invoices and projects for employees; review, payment and projects for accounts payable.", ...apply("Screens and navigation for employees and accounts payable", screens) },
    { say: "Finally, sample data from the existing prototype and five people to try it as.", ...apply("Sample data and people to preview as", samples) },
    { say: "Let me check it as an employee.", action: "app_set_preview", input: { person: "priya", screen: "invoices" } },
    { say: "And as accounts payable.", action: "app_set_preview", input: { person: "morgan", screen: "review" } },
    { action: "app_show_panel", input: { panel: "rules" } },
  ],
  summary:
    "Your time tracker is ready, and UMF validated every version.\n\n" +
    "- **Employees** see their week's calendar, add time to invoices (from events or by hand), add expenses with receipts, and submit, withdraw or resubmit invoices. They keep their own rate per project and can add their own projects.\n" +
    "- **Accounts payable** reviews submitted invoices (approve, or return with a reason), marks approved ones paid, and keeps the organization's projects. Nobody can approve or pay their own invoice.\n\n" +
    "I assumed US dollars, today as 12 November 2026 for the sample data, and the Plain theme. Try it as each person with **Signed in as**, or ask me for a variant (for example, one for contractors).",
};

export const DIFFERENCES = [
  "Lines are live from calendar events at the current rate; time-tracker-2 freezes a snapshot of rates and project names on submit.",
  "Invoices keep the seeded numbers but new ones are not numbered on submit (app profile 0.1 has no sequences).",
  "There is no per-person \"working on\" invoice: you choose the invoice when adding time.",
  "Deleting a draft requires it to be empty (time-tracker-2 detaches its events and offers Undo); there is no Undo in 0.1.",
  "Mark paid is per invoice, not in bulk; Select several (bulk add from the calendar) is not offered.",
  "The prototype's defects are fixed on purpose: payment dates can't be in the future or before approval, and withdrawn invoices keep their dates.",
];

/* Apply the build to a starter definition (tests and the seed script). */
export async function buildDefinition(apply, starter) {
  let doc = starter;
  for (const step of BUILD.steps) if (step.action === "app_apply_operations") for (const o of step.input.operations) doc = apply(doc, o.op, o.args);
  return doc;
}
