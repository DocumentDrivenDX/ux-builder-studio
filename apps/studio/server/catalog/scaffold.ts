/* A first version of an app on catalog data, made at once from the tables
   the person chose, so there is something to see and use before the App
   Expert starts: the tables as records (read as the person), their links,
   the roles (from the groups the catalog grants the tables to), a screen to
   list and one to read each table, and then by kind:
   - reporting: a dashboard of headline numbers and charts;
   - data management: Add and Edit on the tables the app may change.
   The App Expert then shapes it with the person. */

import { fieldTypeOfColumn } from "@ux-builder/app-definition";
import type { CatalogTable } from "./service.js";

type Op = { op: string; args: Record<string, unknown> };
export type Kind = "reporting" | "data-management" | "own-data";
export type Chosen = { table: CatalogTable; access: "read" | "change" };

const rule = (tree: unknown) => ({ language: "umf.app.expr", version: "1", expression: JSON.stringify(tree), references: [] });
const recordIdOf = (t: CatalogTable) => t.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^([^a-z])/, "c_$1").slice(0, 41);
const singular = (s: string) => s.replace(/ies$/, "y").replace(/(ses|xes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, "$1");
const titleOf = (s: string) => { const t = s.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const FORMAT: Record<string, string> = { money: "currency", hours: "hours", date: "date", datetime: "datetime", email: "email", integer: "number", number: "number" };

/* The addSource arguments for a table, from what the catalog says about it. */
export function sourceArgs(t: CatalogTable, access: "read" | "change") {
  return {
    asset: t.fullName,
    access,
    record: recordIdOf(t),
    title: titleOf(singular(t.name)),
    ...(t.comment ? { description: t.comment } : {}),
    key: t.primaryKey ?? t.columns[0]?.name,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable, ...(c.comment ? { description: c.comment } : {}), ...(c.values ? { values: c.values } : {}) })),
  };
}

/* Can the person ask this of the table? The app can never ask for more than the catalog gives them. */
export function accessProblem(t: CatalogTable, access: "read" | "change") {
  if (!t.access.read) return `You can't read ${t.fullName} in the data catalog`;
  if (access === "change" && !t.access.change) return `You can read ${t.fullName} but not change it, so an app of yours can't change it either`;
  return null;
}

export function scaffoldOperations({ kind, chosen, appName, user }: { kind: Kind; chosen: Chosen[]; appName: string; user: { groups: string[] } }): Op[] {
  const ops: Op[] = [{ op: "setIdentity", args: { kind, description: kind === "reporting" ? `Reports on ${chosen.map((c) => c.table.name.replace(/_/g, " ")).join(", ")}` : `Keeps ${chosen.map((c) => c.table.name.replace(/_/g, " ")).join(", ")} up to date` } }];
  const recs = chosen.map((c) => ({ ...c, id: recordIdOf(c.table), args: sourceArgs(c.table, c.access) }));
  for (const r of recs) ops.push({ op: "addSource", args: r.args });

  // Links the catalog declares between the chosen tables.
  for (const r of recs) {
    for (const fk of r.table.foreignKeys) {
      const parent = recs.find((x) => x.table.fullName.toLowerCase() === fk.parent.toLowerCase());
      if (parent && parent !== r) ops.push({ op: "addRelationship", args: { id: `${r.id}_${fk.column}`.slice(0, 63).replace(/_/g, "-"), from: r.id, to: parent.id, field: fk.column.toLowerCase(), name: `${r.id}_${parent.id}`, required: false } });
    }
  }

  // Roles: everyone the app is shared with reads it ("*"); in data management, the groups the catalog lets change the tables edit.
  const changeGroups = [...new Set(recs.filter((r) => r.access === "change").map((r) => r.table.access.changeVia).filter(Boolean) as string[])];
  const mine = user.groups.filter((g) => g !== "studio-builders");
  ops.push({ op: "setRoleGroups", args: { id: "member", groups: ["*"] } });
  ops.push({ op: "applyPatch", args: [{ op: "replace", path: "/extensions/umf.app/roles/0/name", value: kind === "reporting" ? "Reader" : "Viewer" }] as never });
  const editing = kind === "data-management" && recs.some((r) => r.access === "change");
  if (editing) ops.push({ op: "addRole", args: { id: "editor", name: "Editor", description: "May change the data the app manages", groups: changeGroups.length ? changeGroups : mine } });
  const everyone = editing ? ["member", "editor"] : ["member"];

  const screens: Op[] = [];
  const nav: Array<Record<string, unknown>> = [];
  const home: Array<Record<string, unknown>> = [];
  const ref = (rec: string, field: string) => ({ module: "app", element: `${rec}__${field}` });

  for (const r of recs) {
    const cols = r.args.columns.map((c) => ({ ...c, field: c.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_"), ftype: fieldTypeOfColumn(c), masked: !!r.table.columns.find((x) => x.name === c.name)?.mask }));
    const key = String(r.args.key).toLowerCase();
    const label = cols.find((c) => /^(name|title)$/.test(c.field)) ?? cols.find((c) => c.field !== key && c.ftype === "text") ?? cols[0];
    const shown = [label, ...cols.filter((c) => c !== label && c.field !== key)].slice(0, 6);
    const value = (c: (typeof cols)[number]) => ({ field: ref(r.id, c.field), ...(c.values ? { format: "status" } : FORMAT[c.ftype] ? { format: FORMAT[c.ftype] } : {}) });
    const plural = titleOf(r.table.name);
    const one = r.args.title as string;
    const writable = editing && r.access === "change";

    if (writable) {
      // A masked column is never offered for editing: someone who sees it masked would overwrite it with nothing.
      const editable = cols.filter((c) => c.field !== key && !c.masked);
      ops.push({ op: "addAction", args: { id: `add-${r.id}`.replace(/_/g, "-"), name: `Add ${one.toLowerCase()}`, record: r.id, kind: "create", inputs: editable.filter((c) => c.nullable === false || c.values).map((c) => c.field).concat(editable.filter((c) => !(c.nullable === false || c.values)).map((c) => c.field)), optional: editable.filter((c) => c.nullable !== false).map((c) => c.field), roles: ["editor"] } });
      ops.push({ op: "addAction", args: { id: `edit-${r.id}`.replace(/_/g, "-"), name: `Edit ${one.toLowerCase()}`, record: r.id, kind: "update", inputs: editable.map((c) => c.field), optional: editable.filter((c) => c.nullable !== false).map((c) => c.field), roles: ["editor"] } });
    }
    const controls = (prefill: boolean) => cols.filter((c) => c.field !== key && !c.masked).map((c) => ({
      parameter: c.field,
      label: titleOf(c.field),
      ...(c.values ? { control: "select", options: { values: c.values.map((v) => ({ value: v, label: titleOf(v) })) } } : c.ftype === "money" ? { control: "currency" } : c.ftype === "hours" ? { control: "hours" } : ["integer", "number"].includes(c.ftype) ? { control: "number" } : c.ftype === "date" ? { control: "date" } : c.ftype === "boolean" ? { control: "switch" } : c.ftype === "email" ? { control: "email" } : {}),
      ...(prefill ? { default: rule({ var: `record.${c.field}` }) } : {}),
    }));

    screens.push({ op: "putScreen", args: {
      id: `${r.id}-list`.replace(/_/g, "-"),
      title: plural,
      pattern: "collection",
      ...(writable ? { actions: [{ action: `add-${r.id}`.replace(/_/g, "-"), label: `Add ${one.toLowerCase()}`, emphasis: "primary", roles: ["editor"], inputs: controls(false) }] } : {}),
      regions: [{
        id: `${r.id}-rows`.replace(/_/g, "-"),
        kind: "collection",
        record: { module: "app", element: r.id },
        ...(r.table.comment ? { description: r.table.comment } : {}),
        columns: shown.map(value),
        search: cols.filter((c) => c.ftype === "text" || c.ftype === "email").slice(0, 3).map((c) => ref(r.id, c.field)),
        rowLink: { screen: `${r.id}-detail`.replace(/_/g, "-"), param: rule({ var: `row.${key}` }) },
        empty: { title: `No ${plural.toLowerCase()} to show`, message: r.table.rowFilter ? "The data catalog shows you only the rows you may see; there are none here for you." : "There are none yet." },
      }],
    } });
    screens.push({ op: "putScreen", args: {
      id: `${r.id}-detail`.replace(/_/g, "-"),
      title: rule({ coalesce: [{ var: `record.${label.field}` }, one] }),
      pattern: "record",
      param: { id: r.id, record: { module: "app", element: r.id } },
      back: { screen: `${r.id}-list`.replace(/_/g, "-") },
      ...(writable ? { actions: [{ action: `edit-${r.id}`.replace(/_/g, "-"), label: "Edit", emphasis: "primary", roles: ["editor"], bind: [{ parameter: "target", from: "param" }], inputs: controls(true) }] } : {}),
      regions: [{ id: `${r.id}-fields`.replace(/_/g, "-"), kind: "record", fields: cols.map(value) }],
    } });
    nav.push({ id: `nav-${r.id}`.replace(/_/g, "-"), label: plural, icon: "view", screen: `${r.id}-list`.replace(/_/g, "-") });
  }

  // Reporting: a dashboard over the first table, with what its columns allow.
  if (kind === "reporting" && recs.length) {
    const r = recs[0];
    const cols = r.args.columns.map((c) => ({ field: c.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_"), ftype: fieldTypeOfColumn(c), values: c.values }));
    const money = cols.find((c) => c.ftype === "money") ?? cols.find((c) => c.ftype === "hours") ?? cols.find((c) => c.ftype === "number");
    const date = cols.find((c) => c.ftype === "date" || c.ftype === "datetime");
    const choice = cols.find((c) => c.values && c.values.length <= 12);
    const plural = titleOf(r.table.name);
    const tiles: Array<Record<string, unknown>> = [{ label: plural, format: "number", value: rule({ count: [{ rows: r.id }] }) }];
    if (money) tiles.push({ label: `Total ${money.field.replace(/_/g, " ")}`, format: money.ftype === "money" ? "currency" : money.ftype === "hours" ? "hours" : "number", value: rule({ sum: [{ rows: r.id }, money.field] }) });
    const regions: Array<Record<string, unknown>> = [{ id: "headline", kind: "stats", tiles }];
    const measure = money ? { aggregate: "sum", field: ref(r.id, money.field), label: `Total ${money.field.replace(/_/g, " ")}`, format: money.ftype === "money" ? "currency" : money.ftype === "hours" ? "hours" : "number" } : { aggregate: "count", label: plural };
    if (date) regions.push({ id: "by-month", kind: "chart", title: `${measure.label} by month`, chart: "line", record: { module: "app", element: r.id }, groupBy: { field: ref(r.id, date.field) }, bucket: "month", measure, limit: 24 });
    if (choice) regions.push({ id: `by-${choice.field}`.replace(/_/g, "-"), kind: "chart", title: `${plural} by ${choice.field.replace(/_/g, " ")}`, chart: "bar", record: { module: "app", element: r.id }, groupBy: { field: ref(r.id, choice.field) }, measure: { aggregate: "count", label: plural } });
    screens.unshift({ op: "putScreen", args: { id: "dashboard", title: appName, description: "Read from the data catalog as you: you see only what the catalog lets you see.", pattern: "dashboard", regions } });
    nav.unshift({ id: "nav-dashboard", label: "Dashboard", icon: "home", screen: "dashboard" });
  }
  ops.push(...screens);
  ops.push({ op: "removeScreen", args: { id: "home" } });
  ops.push({ op: "setNavigation", args: { navigation: nav, home: [{ roles: everyone, screen: String((nav[0] as { screen: string }).screen) }] } });
  return ops;
}
