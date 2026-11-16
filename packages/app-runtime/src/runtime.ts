/* What a definition means for one signed-in person and one snapshot of data:
   expression scopes, text, display values, which screens, regions and action
   placements they may see, and how an action placement's parameters are bound
   or asked for. No React here; the components read everything through this. */

import { evaluate, humanize, indexDefinition, makeScope, mayRun, parseRule, refKey, related } from "./engine";
import type { ActionDecl, ActionParameter, DataScope, DefinitionIndex, DerivedDecl, FieldInfo, RecordInfo, Rule } from "./definition-api";
import type { AppDefinition, Identity, Json, Location, Row, Snapshot } from "./contract";
import type { Binding, Control, ControlKind, Format, Navigate, Placement, Region, Screen, StatusMap, Text, Tone, UxExtension, ValueRef } from "./definition";
import { EMPTY, formatValue, NUMERIC_FORMATS } from "./format";

const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

/** Variables an expression can read, beyond the data access in DataScope. */
export type Scope = DataScope & {
  row?: Row | null;
  record?: Row | null;
  params?: Record<string, unknown>;
  param?: Record<string, unknown>;
  selection?: string[];
  input?: Record<string, unknown>;
};

export interface Runtime {
  definition: AppDefinition;
  idx: DefinitionIndex;
  ux: UxExtension;
  identity: Identity;
  snapshot: Snapshot;
  /** The scope every expression starts from: user, app, $now, $rows, $related. */
  base: Scope;
  derivedById: Map<string, DerivedDecl>;
}

/** Index a definition once; the index is reused across snapshots. */
export const indexOf = (definition: AppDefinition): DefinitionIndex => indexDefinition(definition);

export function createRuntime(definition: AppDefinition, idx: DefinitionIndex, identity: Identity, snapshot: Snapshot): Runtime {
  const derivedById = new Map<string, DerivedDecl>();
  for (const ds of idx.derived.values()) for (const d of ds) derivedById.set(d.id, d);
  const base = makeScope(idx, snapshot.records, identity, snapshot.now) as Scope;
  return { definition, idx, ux: (idx.ux ?? {}) as UxExtension, identity, snapshot, base, derivedById };
}

export const scopeWith = (rt: Runtime, extra: Partial<Scope>): Scope => ({ ...rt.base, ...extra });

/* ---------- expressions ---------- */

/** Evaluate a rule; an expression that fails yields undefined (and is reported once in development). */
export function evalRule(rule: Rule | undefined | null, scope: Scope): unknown {
  if (!rule) return undefined;
  try {
    return evaluate(parseRule(rule), scope);
  } catch (e) {
    reportOnce(rule.expression, e);
    return undefined;
  }
}

/** Does a condition hold? A missing condition holds; a failing one does not. */
export function ruleHolds(rule: Rule | undefined | null, scope: Scope): boolean {
  if (!rule) return true;
  const v = evalRule(rule, scope);
  return Array.isArray(v) ? v.length > 0 : !!v;
}

const reported = new Set<string>();
function reportOnce(expression: string, e: unknown) {
  if (reported.has(expression)) return;
  reported.add(expression);
  console.warn(`[app-runtime] expression failed: ${expression}: ${e instanceof Error ? e.message : String(e)}`);
}

/** Literal text, or the value of a text expression. */
export function text(t: Text | undefined | null, scope: Scope): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  const v = evalRule(t, scope);
  return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
}

/* ---------- roles and visibility ---------- */

/** An empty or missing role list means everyone. */
export const rolesAllow = (roles: string[] | undefined, identity: Identity) =>
  !list(roles).length || list(roles).some((r) => identity.roles.includes(r));

export const screenById = (rt: Pick<Runtime, "ux">, id: string | undefined): Screen | undefined => list(rt.ux.screens).find((s) => s.id === id);

export const screenVisible = (screen: Screen | undefined, identity: Identity) => !!screen && rolesAllow(screen.roles, identity);

/** Navigation for this person: items for their roles, whose screens they may see. */
export function navigationFor(ux: UxExtension, identity: Identity) {
  return list(ux.shell?.navigation).filter((n) => rolesAllow(n.roles, identity) && screenVisible(list(ux.screens).find((s) => s.id === n.screen), identity));
}

/** The first screen: the first home entry for one of the person's roles, else the first navigation item. */
export function homeFor(ux: UxExtension, identity: Identity): Location | null {
  for (const h of list(ux.shell?.home)) {
    const s = list(ux.screens).find((x) => x.id === h.screen);
    if (list(h.roles).some((r) => identity.roles.includes(r)) && screenVisible(s, identity) && !s?.param) return { screen: h.screen };
  }
  const first = navigationFor(ux, identity)[0];
  return first ? { screen: first.screen } : null;
}

export const regionVisible = (region: Region, rt: Runtime, scope: Scope) => rolesAllow(region.roles, rt.identity) && ruleHolds(region.when, scope);

/* ---------- records, rows and fields ---------- */

export const rowsOf = (rt: Runtime, recordId: string | undefined): Row[] => (recordId ? list(rt.snapshot.records[recordId]) : []);

export function findRow(rt: Runtime, recordId: string | undefined, key: string | undefined): Row | undefined {
  if (key == null) return undefined;
  return rowsOf(rt, recordId).find((r) => r.$key === String(key));
}

/** Rows related to `row` through a relationship (by id or name), in either direction. */
export const relatedRows = (rt: Runtime, row: Row | null | undefined, name: string): Row[] =>
  related(rt.idx, rt.snapshot.records, row, name) as Row[];

/** The record a relationship from `from` leads to (its source when `from` is the target). */
export function relatedRecord(rt: Runtime, from: RecordInfo | undefined, name: string): RecordInfo | undefined {
  if (!from) return undefined;
  const rel = rt.idx.relationshipByName(from.ref, name);
  if (!rel) return undefined;
  return refKey(rel.source) === refKey(from.ref) ? rt.idx.record(rel.target) : rt.idx.record(rel.source);
}

/** The field to name a row by: name, title or label, else the first plain text field, else the key. */
export function displayField(rec: RecordInfo): FieldInfo | undefined {
  const byName = rec.fields.find((f) => ["name", "title", "label"].includes(f.name));
  if (byName) return byName;
  return rec.fields.find((f) => f.name !== rec.keyName && ["text", "email", "choice"].includes(f.type)) ?? rec.fields.find((f) => f.name === rec.keyName);
}

export function rowName(rec: RecordInfo | undefined, row: Row): string {
  const f = rec ? displayField(rec) : undefined;
  const v = f ? row[f.name] : null;
  return v == null || v === "" ? row.$key : String(v);
}

/** The relationship whose foreign key is this field, if any. */
export function foreignKeyOf(rt: Runtime, field: FieldInfo | undefined) {
  if (!field) return undefined;
  return [...rt.idx.relationships.values()].find((r) => r.fieldName === field.name && refKey(r.source) === refKey(field.record));
}

/* ---------- display values ---------- */

export interface ResolvedValue {
  raw: unknown;
  text: string;
  format: Format;
  status?: { tone: Tone; label: string };
  secondary?: string;
}

const FORMAT_OF_TYPE: Partial<Record<FieldInfo["type"], Format>> = {
  money: "currency", hours: "hours", integer: "number", number: "number", date: "date", datetime: "datetime", time: "time", email: "email", longtext: "multiline",
};

export function valueField(rt: Runtime, vr: ValueRef): FieldInfo | undefined {
  return vr.field ? rt.idx.field(vr.field) : undefined;
}

export function valueLabel(rt: Runtime, vr: ValueRef): string {
  if (vr.label) return vr.label;
  if (vr.field) return valueField(rt, vr)?.title ?? humanize(vr.field.element);
  if (vr.derived) {
    const d = rt.derivedById.get(vr.derived);
    return d?.title ?? humanize(d?.name ?? vr.derived);
  }
  return "";
}

export function valueFormat(rt: Runtime, vr: ValueRef): Format {
  if (vr.format) return vr.format;
  if (vr.status) return "status";
  if (vr.field) return FORMAT_OF_TYPE[valueField(rt, vr)?.type ?? "text"] ?? "text";
  if (vr.derived) return (rt.derivedById.get(vr.derived)?.format as Format | undefined) ?? "text";
  return "text";
}

export const valueIsNumeric = (rt: Runtime, vr: ValueRef) => vr.numeric ?? NUMERIC_FORMATS.has(valueFormat(rt, vr));

/** The raw value of a value reference for a row (fields and derived values are read; expressions run with the row in scope). */
export function rawValue(rt: Runtime, vr: ValueRef, row: Row | null | undefined, scope: Scope): unknown {
  if (vr.field) {
    const f = valueField(rt, vr);
    return row && f ? row[f.name] : undefined;
  }
  if (vr.derived) {
    const d = rt.derivedById.get(vr.derived);
    return row && d ? row[d.name] : undefined;
  }
  if (vr.value) return evalRule(vr.value, { ...scope, row: row ?? scope.row });
  return undefined;
}

export function statusOf(map: StatusMap | undefined, raw: unknown): { tone: Tone; label: string } {
  const key = raw == null ? "" : String(raw);
  const entry = map?.[key];
  return { tone: entry?.tone ?? "neutral", label: entry?.label ?? (key ? humanize(key) : EMPTY) };
}

export function resolveValue(rt: Runtime, vr: ValueRef, row: Row | null | undefined, scope: Scope): ResolvedValue {
  const raw = rawValue(rt, vr, row, scope);
  const format = valueFormat(rt, vr);
  const field = valueField(rt, vr);
  let shown = formatValue(raw, format, rt.snapshot.now);
  // Choice values are identifiers; show them as words unless a status map names them.
  if (format === "text" && field?.type === "choice" && typeof raw === "string" && raw) shown = humanize(raw);
  const out: ResolvedValue = { raw, text: shown, format };
  if (format === "status") {
    out.status = statusOf(vr.status, raw);
    out.text = out.status.label;
  }
  if (vr.secondary) {
    const s = evalRule(vr.secondary, { ...scope, row: row ?? scope.row });
    if (s != null && s !== "") out.secondary = String(s);
  }
  return out;
}

/** Sort key for a value: numbers as numbers, everything else as text; missing values sort last. */
export function sortKey(v: unknown): number | string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v).toLowerCase();
}

export function compareKeys(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Navigation target for a link from a row or a screen. */
export function resolveNavigate(nav: Navigate, scope: Scope): Location {
  const v = nav.param ? evalRule(nav.param, scope) : undefined;
  return v == null || v === "" ? { screen: nav.screen } : { screen: nav.screen, param: String(v) };
}

/* ---------- actions ---------- */

export const actionOf = (rt: Runtime, id: string): ActionDecl | undefined => rt.idx.actions.get(id);

export const actionLabel = (rt: Runtime, p: Placement) => p.label ?? actionOf(rt, p.action)?.name ?? humanize(p.action);

export const actionKind = (a: ActionDecl | undefined): "create" | "update" | "delete" | "other" => {
  const effects = list(a?.binding?.effects);
  if (effects.some((e) => e.kind === "delete")) return "delete";
  if (effects.some((e) => e.kind === "create")) return "create";
  if (effects.some((e) => e.kind === "set" || e.kind === "link" || e.kind === "unlink")) return "update";
  return "other";
};

export const isDestructive = (rt: Runtime, p: Placement) => p.emphasis === "destructive" || actionKind(actionOf(rt, p.action)) === "delete";

/** May this person see and use this placement here? Authorization, placement roles and its condition must all allow it. */
export function placementVisible(rt: Runtime, p: Placement, scope: Scope): boolean {
  if (!actionOf(rt, p.action)) return false;
  if (!mayRun(rt.idx, p.action, rt.identity)) return false;
  if (!rolesAllow(p.roles, rt.identity)) return false;
  return ruleHolds(p.when, scope);
}

/** Where an action placement is offered: the row it acts on, the screen's parameter, the selection. */
export interface ActionContext {
  scope: Scope;
  row?: Row;
  screenKey?: string;
  selection?: string[];
  /** Called after the action succeeds (for example to clear a selection). */
  onDone?: () => void;
}

/** The record a create action creates, and the parameter that holds its key (minted by the host when not supplied). */
export function createKeyParam(rt: Runtime, a: ActionDecl): ActionParameter | undefined {
  const create = list(a.binding?.effects).find((e) => e.kind === "create");
  const rec = create?.record ? rt.idx.record(create.record) : undefined;
  if (!rec) return undefined;
  return list(a.parameters).find((p) => p.kind === "value" && rt.idx.field(p.field)?.name === rec.keyName);
}

const bindingSource = (b: Binding) => b.from ?? (b.value ? "value" : "input");

/** A row's value for a value parameter: the row's field of the same name, else the row's key when the parameter is a foreign key to the row's record. */
function rowValueFor(rt: Runtime, p: ActionParameter, row: Row): unknown {
  const f = rt.idx.field(p.field);
  if (!f) return row.$key;
  if (Object.prototype.hasOwnProperty.call(row, f.name)) return row[f.name];
  const fk = foreignKeyOf(rt, f);
  const target = fk ? rt.idx.record(fk.target) : undefined;
  return target && target.id === row.$record ? row.$key : undefined;
}

/** Parameter values from the placement's bindings (inputs excluded). Selection-bound entity parameters are returned separately. */
export function boundParams(rt: Runtime, p: Placement, ctx: ActionContext): { params: Record<string, Json>; perSelection?: string } {
  const a = actionOf(rt, p.action);
  const params: Record<string, Json> = {};
  let perSelection: string | undefined;
  if (!a) return { params };
  for (const b of list(p.bind)) {
    const prm = list(a.parameters).find((x) => x.id === b.parameter);
    if (!prm) continue;
    let v: unknown;
    switch (bindingSource(b)) {
      case "row":
        v = ctx.row ? (prm.kind === "entity" ? ctx.row.$key : rowValueFor(rt, prm, ctx.row)) : undefined;
        break;
      case "param":
        v = ctx.screenKey;
        break;
      case "user":
        v = rt.identity.key ?? null;
        break;
      case "value":
        v = evalRule(b.value, { ...ctx.scope, row: ctx.row ?? ctx.scope.row, selection: ctx.selection });
        break;
      case "selection":
        if (prm.kind === "entity") perSelection = prm.id;
        v = ctx.selection ?? [];
        break;
      default:
        continue; // an input
    }
    if (v !== undefined) params[prm.id] = v as Json;
  }
  return { params, perSelection };
}

/* ---------- inputs ---------- */

export interface Option {
  value: string;
  label: string;
}

export interface InputSpec {
  id: string;
  param: ActionParameter;
  field?: FieldInfo;
  label: string;
  hint?: string;
  control: ControlKind;
  required: boolean;
  /** Integer fields take whole numbers. */
  integer: boolean;
  options?: (scope: Scope) => Option[];
  default?: Rule;
}

function recordOptions(rt: Runtime, rec: RecordInfo, labelField: FieldInfo | undefined, filter: Rule | undefined) {
  return (scope: Scope): Option[] => {
    const lf = labelField ?? displayField(rec);
    return rowsOf(rt, rec.id)
      .filter((r) => !filter || ruleHolds(filter, { ...scope, row: r }))
      .map((r) => ({ value: r.$key, label: lf && r[lf.name] != null && r[lf.name] !== "" ? String(r[lf.name]) : r.$key }))
      .sort((x, y) => x.label.localeCompare(y.label));
  };
}

const CONTROL_OF_TYPE: Partial<Record<FieldInfo["type"], ControlKind>> = {
  longtext: "textarea", email: "email", integer: "number", number: "number", money: "currency", hours: "hours", boolean: "checkbox", date: "date", time: "time", datetime: "datetime",
};

function inputSpec(rt: Runtime, a: ActionDecl, prm: ActionParameter, c: Control | undefined): InputSpec {
  const field = prm.kind === "value" ? rt.idx.field(prm.field) : undefined;
  const target = prm.kind === "entity" ? rt.idx.record(prm.target) : undefined;
  const fk = foreignKeyOf(rt, field);
  const fkTarget = fk ? rt.idx.record(fk.target) : undefined;
  let options: InputSpec["options"];
  if (c?.options?.values?.length) {
    const values = c.options.values.map((o) => ({ value: String(o.value), label: o.label }));
    options = () => values;
  } else if (c?.options?.record && rt.idx.record(c.options.record)) {
    options = recordOptions(rt, rt.idx.record(c.options.record)!, c.options.label ? rt.idx.field(c.options.label) : undefined, c.options.filter);
  } else if (target) {
    options = recordOptions(rt, target, undefined, c?.options?.filter);
  } else if (field?.allowedValues.length) {
    const values = field.allowedValues.map((v) => ({ value: String(v), label: humanize(String(v)) }));
    options = () => values;
  } else if (fkTarget) {
    options = recordOptions(rt, fkTarget, undefined, c?.options?.filter);
  }
  const control: ControlKind = c?.control ?? (options ? "select" : CONTROL_OF_TYPE[field?.type ?? "text"] ?? "text");
  const label = c?.label ?? (fkTarget ? fkTarget.title : field?.title) ?? target?.title ?? humanize(prm.id);
  void a;
  return {
    id: prm.id,
    param: prm,
    field,
    label,
    hint: c?.hint,
    control,
    required: prm.required !== false,
    integer: field?.scalarType === "integer",
    options,
    default: c?.default,
  };
}

/** The parameters the person fills in: the placement's inputs in order, then every other unbound value parameter (a create's key excepted: the host mints it). */
export function actionInputs(rt: Runtime, p: { action: string; bind?: Binding[]; inputs?: Control[] }): InputSpec[] {
  const a = actionOf(rt, p.action);
  if (!a) return [];
  const bound = new Set(list(p.bind).filter((b) => bindingSource(b) !== "input").map((b) => b.parameter));
  const key = createKeyParam(rt, a);
  const out: InputSpec[] = [];
  const seen = new Set<string>();
  for (const c of list(p.inputs)) {
    const prm = list(a.parameters).find((x) => x.id === c.parameter);
    if (!prm || seen.has(prm.id) || bound.has(prm.id)) continue;
    seen.add(prm.id);
    out.push(inputSpec(rt, a, prm, c));
  }
  for (const prm of list(a.parameters)) {
    if (seen.has(prm.id) || bound.has(prm.id) || prm.id === key?.id) continue;
    if (prm.kind === "entity" && !list(p.bind).some((b) => b.parameter === prm.id)) continue; // unbound entities are a validation error, not a question
    seen.add(prm.id);
    out.push(inputSpec(rt, a, prm, undefined));
  }
  return out;
}

/** Initial values for inputs: each control's default, as the control holds it. */
export function initialValues(inputs: InputSpec[], scope: Scope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of inputs) {
    const v = s.default ? evalRule(s.default, scope) : undefined;
    if (s.control === "checkbox" || s.control === "switch") out[s.id] = v === true || v === "true";
    else if (s.control === "datetime") out[s.id] = v == null ? "" : toLocalInput(String(v));
    else out[s.id] = v == null ? "" : String(v);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** A wall-clock timestamp as a datetime-local input value ("YYYY-MM-DDTHH:MM", in UTC). */
function toLocalInput(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const blank = (v: unknown) => v === undefined || v === null || v === "";
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const NUMBER_CONTROLS = new Set<ControlKind>(["number", "currency", "hours"]);
const CHOOSE_CONTROLS = new Set<ControlKind>(["select", "choice"]);

/** Client-side checks before an action runs: required values and number shapes. The host checks everything again. */
export function validateInputs(inputs: InputSpec[], values: Record<string, unknown>): Record<string, string | null> {
  const errors: Record<string, string | null> = {};
  for (const s of inputs) {
    const v = values[s.id];
    const lower = s.label.toLowerCase();
    if (s.control === "checkbox" || s.control === "switch" || s.control === "file") continue;
    if (blank(v)) {
      if (s.required) errors[s.id] = CHOOSE_CONTROLS.has(s.control) ? `Choose ${article(lower)} ${lower}` : `Enter the ${lower}`;
      continue;
    }
    if (NUMBER_CONTROLS.has(s.control) || s.field?.scalarType === "integer" || s.field?.scalarType === "decimal") {
      const n = Number(v);
      if (Number.isNaN(n)) errors[s.id] = `${s.label} must be a number`;
      else if (s.integer && !Number.isInteger(n)) errors[s.id] = `${s.label} must be a whole number`;
    } else if (s.control === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
      errors[s.id] = "Enter an email address in the right format, like name@example.org";
    }
  }
  return errors;
}

/** Input values as action parameter values: numbers as numbers, wall-clock timestamps as ISO strings with "Z", empty as null. */
export function inputParams(inputs: InputSpec[], values: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const s of inputs) {
    const v = values[s.id];
    if (s.control === "checkbox" || s.control === "switch") { out[s.id] = !!v; continue; }
    if (blank(v)) { out[s.id] = null; continue; }
    const numericField = s.field && ["integer", "decimal", "float"].includes(s.field.scalarType);
    if (NUMBER_CONTROLS.has(s.control) || numericField) out[s.id] = Number(v);
    else if (s.control === "datetime") {
      // datetime-local gives wall-clock "YYYY-MM-DDTHH:MM"; definitions store wall-clock time as UTC.
      const raw = String(v);
      const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.length === 16 ? `${raw}:00` : raw}Z`);
      out[s.id] = Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
    } else out[s.id] = String(v);
  }
  return out;
}

/** The input a failed action's message belongs to: the host's field, else the one input its failed precondition reads. */
export function failureField(rt: Runtime, actionId: string, failure: { code: string; field?: string }, inputs: InputSpec[]): string | undefined {
  const ids = new Set(inputs.map((s) => s.id));
  if (failure.field && ids.has(failure.field)) return failure.field;
  const a = actionOf(rt, actionId);
  const pre = list(a?.preconditions).find((c) => c.failure?.code === failure.code);
  if (!pre) return undefined;
  const read = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [op, args] of Object.entries(node)) {
      if (op === "var") {
        const path = Array.isArray(args) ? args[0] : args;
        const m = typeof path === "string" ? /^params?\.([^.]+)/.exec(path) : null;
        if (m) read.add(m[1]);
      } else walk(args);
    }
  };
  try {
    walk(parseRule(pre.rule));
  } catch {
    return undefined;
  }
  const hits = [...read].filter((id) => ids.has(id));
  return hits.length === 1 && read.size === 1 ? hits[0] : undefined;
}

/** The sentence a successful action ends with when the placement gives no toast. */
export function defaultSuccess(rt: Runtime, actionId: string): string {
  const a = actionOf(rt, actionId);
  const effects = list(a?.binding?.effects);
  const recRef = effects.find((e) => e.record)?.record;
  const entityParam = effects.find((e) => e.entity?.parameter)?.entity?.parameter;
  const target = list(a?.parameters).find((p) => p.id === entityParam)?.target;
  const rec = (recRef && rt.idx.record(recRef)) || (target && rt.idx.record(target)) || undefined;
  const noun = rec?.title ?? "Record";
  switch (actionKind(a)) {
    case "create": return `${noun} added`;
    case "delete": return `${noun} deleted`;
    case "update": return `${noun} updated`;
    default: return `${a?.name ?? "Action"} done`;
  }
}
