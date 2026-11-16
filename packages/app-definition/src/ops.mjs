/* Operations on an app definition: the small, typed edits the studio's panels
   and its agent make ("add a record with these fields", "add an action that
   submits an invoice"). Each takes a document and returns a new one (the input
   is never mutated) and writes canonical UMF: field elements owned by exactly
   one record, primary keys, relationships between records with their foreign
   key fields named in umf.app, and complete umf.actions declarations. They
   throw OpError for arguments that cannot be applied; whether the result is a
   good app is the validator's job, run after every operation. */

import { rule } from "./expr.mjs";
import { indexDefinition, refKey, toLiteral, humanize } from "./model.mjs";

export class OpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const list = (v) => (Array.isArray(v) ? v : []);
const NAME = /^[a-z][a-z0-9_]{0,40}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const need = (cond, code, message) => {
  if (!cond) throw new OpError(code, message);
};

export const FIELD_TYPES = {
  text: { scalarType: "string" },
  longtext: { scalarType: "string" },
  email: { scalarType: "string" },
  integer: { scalarType: "integer" },
  number: { scalarType: "decimal", facets: { precision: 14, scale: 4 } },
  money: { scalarType: "decimal", facets: { precision: 12, scale: 2 } },
  hours: { scalarType: "decimal", facets: { precision: 7, scale: 2 } },
  boolean: { scalarType: "boolean" },
  date: { scalarType: "date" },
  time: { scalarType: "time" },
  datetime: { scalarType: "timestamp" },
  choice: { scalarType: "string" },
  id: { scalarType: "string" },
};

/* ---------- documents ---------- */

export function createApp({ id, name, description = "", useCase = "", template = "custom", module = "app", namespace, theme = "plain", title, roles = [{ id: "member", name: "Member" }] }) {
  need(typeof id === "string" && /^[a-z][a-z0-9.-]{0,63}$/.test(id), "OP_ID", `App id ${id} must be lower-case letters, digits, dots or dashes`);
  need(NAME.test(module), "OP_MODULE", `Module id ${module} must be lower-case letters, digits or underscores`);
  return {
    umf: "0.10.0",
    id,
    vocabularies: { "umf.app": { version: "0.1.0" }, "umf.ux": { version: "0.1.0" }, "umf.actions": { version: "0.1.0" } },
    modules: [{ id: module, namespace: namespace ?? id, title: title ?? name, elements: [], relationships: [], extensions: { "umf.actions": { actions: [] } } }],
    extensions: {
      "umf.app": { name, description, useCase, version: "0.1.0", template, visibility: "private", roles, derived: [], access: [], foreignKeys: [], samples: { identities: [], records: [] } },
      "umf.ux": { modality: "responsive-web", look: { theme, appearance: "system" }, shell: { title: name, frame: "side-nav", navigation: [] }, screens: [] },
    },
  };
}

const mod0 = (doc) => doc.modules[0];
const app = (doc) => doc.extensions["umf.app"];
const ux = (doc) => doc.extensions["umf.ux"];
const actionsOf = (doc) => (mod0(doc).extensions ??= {})["umf.actions"] ??= { actions: [] };
const ref = (doc, element) => ({ module: mod0(doc).id, element });
const fieldId = (record, name) => `${record}__${name}`;

function recordEl(doc, record) {
  const el = mod0(doc).elements.find((e) => e.kind === "record" && (e.id === record || e.name === record));
  need(el, "OP_RECORD", `There is no record ${record}`);
  return el;
}

function fieldElement(doc, record, f) {
  need(f && NAME.test(f.name ?? ""), "OP_FIELD", `Field name ${f?.name} must be lower-case letters, digits or underscores`);
  const t = FIELD_TYPES[f.type ?? "text"];
  need(t, "OP_FIELD_TYPE", `Field type ${f.type} is not one of ${Object.keys(FIELD_TYPES).join(", ")}`);
  const el = {
    id: fieldId(record, f.name),
    name: f.name,
    title: f.title ?? humanize(f.name),
    kind: "field",
    scalarType: t.scalarType,
    nullability: f.required === false ? "absent-allowed" : "required",
    cardinality: "one",
    extensions: {},
  };
  if (f.description) el.description = f.description;
  const facets = { ...(t.facets ?? {}) };
  if (f.precision != null) facets.precision = f.precision;
  if (f.scale != null) facets.scale = f.scale;
  if (Object.keys(facets).length) el.facets = facets;
  if (list(f.values).length) el.allowedValues = f.values.map((v) => toLiteral(v, t.scalarType));
  // The presentation type (money, hours, email…) is ux-builder's, not UMF core's: it lives in umf.app.
  const types = (app(doc).fieldTypes ??= {});
  if (f.type && f.type !== "text") types[el.id] = f.type;
  else delete types[el.id];
  return el;
}

/* ---------- identity and look ---------- */

export function setIdentity(doc, { name, description, useCase, version, template, tags, visibility }) {
  const d = clone(doc);
  const a = app(d);
  if (name != null) { a.name = name; ux(d).shell.title = name; mod0(d).title = name; }
  if (description != null) a.description = description;
  if (useCase != null) a.useCase = useCase;
  if (version != null) a.version = version;
  if (template != null) a.template = template;
  if (tags != null) a.tags = tags;
  if (visibility != null) a.visibility = visibility;
  return d;
}

export function setLook(doc, look) {
  const d = clone(doc);
  ux(d).look = { ...ux(d).look, ...Object.fromEntries(Object.entries(look).filter(([, v]) => v != null)) };
  // An empty brand kit stops using one; the theme shows again.
  if (ux(d).look.brandKit === "") delete ux(d).look.brandKit;
  return d;
}

export function setShell(doc, { title, frame }) {
  const d = clone(doc);
  if (title) ux(d).shell.title = title;
  if (frame) ux(d).shell.frame = frame;
  return d;
}

/* ---------- roles ---------- */

export function addRole(doc, { id, name, description }) {
  need(ID.test(id ?? ""), "OP_ID", `Role id ${id} must be lower-case`);
  const d = clone(doc);
  need(!app(d).roles.some((r) => r.id === id), "OP_EXISTS", `Role ${id} already exists`);
  app(d).roles.push({ id, name: name ?? humanize(id), ...(description ? { description } : {}) });
  return d;
}

export function removeRole(doc, { id }) {
  const d = clone(doc);
  app(d).roles = app(d).roles.filter((r) => r.id !== id);
  return d;
}

/* ---------- records and fields ---------- */

export function addRecord(doc, { id, title, description, fields = [], key = "id" }) {
  need(NAME.test(id ?? ""), "OP_ID", `Record id ${id} must be lower-case letters, digits or underscores`);
  const d = clone(doc);
  const m = mod0(d);
  need(!m.elements.some((e) => e.id === id), "OP_EXISTS", `There is already an element ${id}`);
  const all = fields.some((f) => f.name === key) ? fields : [{ name: key, type: "id", title: "ID" }, ...fields];
  const els = all.map((f) => fieldElement(d, id, f));
  const names = new Set();
  for (const e of els) { need(!names.has(e.name), "OP_FIELD", `Field ${e.name} is listed twice`); names.add(e.name); }
  m.elements.push(...els, {
    id,
    name: id,
    title: title ?? humanize(id),
    ...(description ? { description } : {}),
    kind: "record",
    members: els.map((e) => ref(d, e.id)),
    keys: [{ id: "pk", name: "primary", primary: true, fields: [ref(d, fieldId(id, key))] }],
    extensions: {},
  });
  return d;
}

export function addField(doc, { record, field }) {
  const d = clone(doc);
  const rec = recordEl(d, record);
  need(!rec.members.some((m) => m.element === fieldId(rec.id, field.name)), "OP_EXISTS", `${rec.id} already has ${field.name}`);
  const el = fieldElement(d, rec.id, field);
  mod0(d).elements.splice(mod0(d).elements.indexOf(rec), 0, el);
  rec.members.push(ref(d, el.id));
  return d;
}

export function updateField(doc, { record, name, changes }) {
  const d = clone(doc);
  const rec = recordEl(d, record);
  const el = mod0(d).elements.find((e) => e.id === fieldId(rec.id, name));
  need(el, "OP_FIELD", `${rec.id} has no field ${name}`);
  const type = changes.type ?? app(d).fieldTypes?.[el.id] ?? "text";
  const merged = fieldElement(d, rec.id, {
    name,
    type,
    title: changes.title ?? el.title,
    description: changes.description ?? el.description,
    required: changes.required ?? el.nullability === "required",
    values: changes.values ?? (el.allowedValues ? el.allowedValues.map((l) => Object.values(l)[0]) : undefined),
    precision: changes.precision,
    scale: changes.scale,
  });
  Object.keys(el).forEach((k) => delete el[k]);
  Object.assign(el, merged);
  return d;
}

export function removeField(doc, { record, name }) {
  const d = clone(doc);
  const rec = recordEl(d, record);
  const id = fieldId(rec.id, name);
  need(!rec.keys?.some((k) => k.fields.some((f) => f.element === id)), "OP_KEY", `${name} is ${rec.id}'s key and cannot be removed`);
  rec.members = rec.members.filter((m) => m.element !== id);
  mod0(d).elements = mod0(d).elements.filter((e) => e.id !== id);
  if (app(d).fieldTypes) delete app(d).fieldTypes[id];
  return d;
}

export function removeRecord(doc, { id }) {
  const d = clone(doc);
  const rec = recordEl(d, id);
  const ids = new Set([rec.id, ...rec.members.map((m) => m.element)]);
  mod0(d).elements = mod0(d).elements.filter((e) => !ids.has(e.id));
  const rels = list(mod0(d).relationships).filter((r) => r.source[0]?.element === rec.id || r.target[0]?.element === rec.id).map((r) => r.id);
  mod0(d).relationships = list(mod0(d).relationships).filter((r) => !rels.includes(r.id));
  app(d).foreignKeys = list(app(d).foreignKeys).filter((fk) => !rels.includes(fk.relationship));
  app(d).derived = list(app(d).derived).filter((x) => x.record.element !== rec.id);
  app(d).access = list(app(d).access).filter((x) => x.record.element !== rec.id);
  app(d).samples.records = list(app(d).samples.records).filter((x) => x.record.element !== rec.id);
  return d;
}

/* A many-to-one link: each `from` row points at one `to` row through `field`
   (created when missing, with the target key's type). */
export function addRelationship(doc, { id, from, to, field, name, required = true, description }) {
  let d = clone(doc);
  const src = recordEl(d, from);
  const tgt = recordEl(d, to);
  const relId = id ?? `${src.id}_${field ?? tgt.id}`;
  need(ID.test(relId), "OP_ID", `Relationship id ${relId} must be lower-case`);
  need(!list(mod0(d).relationships).some((r) => r.id === relId), "OP_EXISTS", `Relationship ${relId} already exists`);
  const fname = field ?? `${tgt.id}_id`;
  if (!src.members.some((m) => m.element === fieldId(src.id, fname))) {
    d = addField(d, { record: src.id, field: { name: fname, type: "id", title: humanize(tgt.title ?? tgt.id), required } });
  }
  const m = mod0(d);
  const relName = name ?? relId;
  need(!list(m.relationships).some((r) => r.name === relName), "OP_EXISTS", `A relationship is already named ${relName}; relationship names are unique in the app`);
  (m.relationships ??= []).push({
    id: relId,
    name: relName,
    source: [ref(d, src.id)],
    target: [{ ...ref(d, tgt.id), key: "pk" }],
    sourceMultiplicity: { min: 0, max: "*" },
    targetMultiplicity: { min: required ? 1 : 0, max: 1 },
    targetLifecycle: "independent",
    directed: true,
  });
  app(d).foreignKeys.push({ relationship: relId, field: ref(d, fieldId(src.id, fname)) });
  return d;
}

/* ---------- derived values and access ---------- */

export function addDerived(doc, { id, record, name, title, type = "number", format, expression, description }) {
  const d = clone(doc);
  const rec = recordEl(d, record);
  need(NAME.test(name ?? ""), "OP_FIELD", `Derived name ${name} must be lower-case`);
  const scalar = { number: "decimal", money: "decimal", hours: "decimal", integer: "integer", text: "string", boolean: "boolean", date: "date", datetime: "timestamp" }[type] ?? "decimal";
  const fmt = format ?? { money: "currency", hours: "hours", date: "date", datetime: "datetime", boolean: "text", text: "text" }[type] ?? "number";
  const did = id ?? `${rec.id}_${name}`;
  need(!list(app(d).derived).some((x) => x.id === did), "OP_EXISTS", `Derived value ${did} already exists`);
  app(d).derived.push({ id: did, record: ref(d, rec.id), name, title: title ?? humanize(name), ...(description ? { description } : {}), scalarType: scalar, format: fmt, expression: rule(expression) });
  return d;
}

export function removeDerived(doc, { id }) {
  const d = clone(doc);
  app(d).derived = list(app(d).derived).filter((x) => x.id !== id);
  return d;
}

export function addAccess(doc, { id, record, roles, when, description }) {
  const d = clone(doc);
  const rec = recordEl(d, record);
  const aid = id ?? `${rec.id}_${roles.join("_")}`;
  app(d).access = list(app(d).access).filter((x) => x.id !== aid);
  app(d).access.push({ id: aid, record: ref(d, rec.id), roles, ...(when ? { when: rule(when) } : {}), ...(description ? { description } : {}) });
  return d;
}

/* ---------- actions ---------- */

const keySelector = (param) => ({ language: "umf.actions.keys", version: "1", expression: JSON.stringify({ entity: param }), references: [{ parameter: param }] });

/* kind: create | update | delete.
   inputs: field names the person (or a binding) supplies, as value parameters.
   set: {field: literal} fixed values. preconditions: [{id, when, message}] in
   umf.app.expr, with params.<id> (the target row for update/delete), user and
   rows() in scope. roles: who may run it. */
export function addAction(doc, { id, name, description, record, kind, target = "target", inputs = [], optional = [], set = {}, preconditions = [], roles, failures = [] }) {
  need(ID.test(id ?? ""), "OP_ID", `Action id ${id} must be lower-case letters, digits, dashes or underscores`);
  need(["create", "update", "delete"].includes(kind), "OP_ACTION_KIND", `Action kind ${kind} must be create, update or delete`);
  need(list(roles).length > 0, "OP_ACTION_ROLES", `Action ${id} needs the roles that may run it`);
  const d = clone(doc);
  const rec = recordEl(d, record);
  const acts = actionsOf(d).actions;
  need(!acts.some((a) => a.id === id), "OP_EXISTS", `Action ${id} already exists`);
  const actionName = name ?? humanize(id);
  need(!acts.some((a) => a.name === actionName), "OP_EXISTS", `Another action is already named "${actionName}"; action names are unique in the app (placements can still label the button differently)`);
  const fieldRef = (n) => {
    need(rec.members.some((m) => m.element === fieldId(rec.id, n)), "OP_FIELD", `${rec.id} has no field ${n}`);
    return ref(d, fieldId(rec.id, n));
  };
  const keyField = rec.keys[0].fields[0].element.split("__")[1];
  const params = [];
  const values = [];
  if (kind !== "create") params.push({ id: target, kind: "entity", target: { ...ref(d, rec.id), key: "pk" }, required: true });
  // A create's key is a required input; the studio runtime mints it when no binding supplies one.
  if (kind === "create") params.push({ id: keyField, kind: "value", field: fieldRef(keyField), required: true });
  for (const n of inputs) {
    if (n === keyField && kind === "create") continue;
    params.push({ id: n, kind: "value", field: fieldRef(n), required: !optional.includes(n) });
    values.push({ field: fieldRef(n), value: { parameter: n } });
  }
  if (kind === "create") values.unshift({ field: fieldRef(keyField), value: { parameter: keyField } });
  for (const [n, v] of Object.entries(set)) {
    const fr = fieldRef(n);
    const fel = mod0(d).elements.find((e) => e.id === fr.element);
    values.push({ field: fr, value: { literal: v === null ? null : toLiteral(v, fel.scalarType) } });
  }
  const writtenFields = [...new Set(values.map((v) => v.field.element))].map((e) => ref(d, e));
  const effects =
    kind === "create"
      ? [{ id: "create", kind: "create", record: ref(d, rec.id), key: "pk", values }]
      : kind === "update"
        ? (need(values.length > 0, "OP_ACTION_EMPTY", `Update action ${id} changes nothing: give inputs or set`), [{ id: "update", kind: "set", entity: { parameter: target }, values }])
        : [{ id: "delete", kind: "delete", entity: { parameter: target } }];
  const conditionFailures = preconditions.map((p) => ({ code: (p.code ?? p.id).toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: p.message, retryable: false }));
  const usesOptional = params.some((p) => p.kind === "value" && p.required === false);
  acts.push({
    id,
    name: actionName,
    description: description ?? actionName,
    parameters: params,
    outputs: [],
    preconditions: preconditions.map((p) => ({
      id: p.id,
      rule: rule(p.when, kind === "create" ? [] : [{ parameter: target }]),
      failure: { code: conditionFailures[preconditions.indexOf(p)].code, message: p.message },
    })),
    postconditions: [],
    failures: [...conditionFailures, ...failures.map((f) => ({ code: f.code, message: f.message, retryable: !!f.retryable }))],
    reads: [],
    writes: [
      {
        id: `${rec.id}-write`,
        record: ref(d, rec.id),
        selector: kind === "create"
          ? { language: "umf.actions.keys", version: "1", expression: JSON.stringify({ key: "pk", components: [{ input: keyField }] }), references: [{ parameter: keyField }] }
          : keySelector(target),
        maxEntities: 1,
        fields: kind === "delete" ? [] : writtenFields,
        relationships: [],
        create: kind === "create",
        delete: kind === "delete",
      },
    ],
    binding: { kind: "recipe", profile: { id: "graph-write", version: usesOptional ? "2" : "1" }, effects },
    authorization: { kind: "roles", profile: { id: "umf.app.roles", version: "1" }, roles },
    attribution: { subject: "person-required" },
    atomicity: "single-store",
    idempotency: "caller-key-optional",
    result: { identities: "created-and-changed", version: "store-opaque", receipt: "read-at-least" },
  });
  return d;
}

export function removeAction(doc, { id }) {
  const d = clone(doc);
  actionsOf(d).actions = actionsOf(d).actions.filter((a) => a.id !== id);
  return d;
}

/* ---------- screens and navigation ---------- */

export function putScreen(doc, screen) {
  need(ID.test(screen?.id ?? ""), "OP_ID", `Screen id ${screen?.id} must be lower-case`);
  const d = clone(doc);
  const s = ux(d).screens;
  const i = s.findIndex((x) => x.id === screen.id);
  if (i >= 0) s[i] = screen;
  else s.push(screen);
  return d;
}

export function removeScreen(doc, { id }) {
  const d = clone(doc);
  ux(d).screens = ux(d).screens.filter((s) => s.id !== id);
  ux(d).shell.navigation = ux(d).shell.navigation.filter((n) => n.screen !== id);
  if (ux(d).shell.home) ux(d).shell.home = ux(d).shell.home.filter((h) => h.screen !== id);
  return d;
}

export function setNavigation(doc, { navigation, home }) {
  const d = clone(doc);
  if (navigation) ux(d).shell.navigation = navigation;
  if (home) ux(d).shell.home = home;
  return d;
}

/* ---------- samples ---------- */

export function setSamples(doc, { record, rows }) {
  const d = clone(doc);
  const rec = recordEl(d, record);
  const s = app(d).samples;
  s.records = list(s.records).filter((x) => x.record.element !== rec.id);
  s.records.push({ record: ref(d, rec.id), rows });
  return d;
}

export function setIdentities(doc, { identities, record, clock }) {
  const d = clone(doc);
  if (identities) app(d).samples.identities = identities;
  if (record) app(d).identity = { record: ref(d, recordEl(d, record).id) };
  if (clock) app(d).samples.clock = clock;
  return d;
}

/* ---------- variants ---------- */

export function makeVariant(doc, { id, name, note }) {
  const d = clone(doc);
  const base = { id: doc.id, version: app(doc).version };
  d.id = id;
  app(d).name = name ?? `${app(doc).name} (variant)`;
  app(d).version = "0.1.0";
  app(d).variantOf = { ...base, ...(note ? { note } : {}) };
  ux(d).shell.title = app(d).name;
  return d;
}

/* ---------- a generic, checked patch ---------- */

export function applyPatch(doc, operations) {
  const d = clone(doc);
  for (const [i, op] of list(operations).entries()) {
    need(op && typeof op.path === "string" && op.path.startsWith("/"), "OP_PATCH", `Patch operation ${i} needs a JSON pointer path`);
    const parts = op.path.slice(1).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    const last = parts.pop();
    let parent = d;
    for (const p of parts) {
      parent = Array.isArray(parent) ? parent[Number(p)] : parent?.[p];
      need(parent != null, "OP_PATCH", `Patch operation ${i}: ${op.path} does not exist`);
    }
    if (op.op === "add") {
      if (Array.isArray(parent)) parent.splice(last === "-" ? parent.length : Number(last), 0, op.value);
      else parent[last] = op.value;
    } else if (op.op === "replace") {
      need(Array.isArray(parent) ? Number(last) < parent.length : last in parent, "OP_PATCH", `Patch operation ${i}: ${op.path} does not exist`);
      parent[Array.isArray(parent) ? Number(last) : last] = op.value;
    } else if (op.op === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    } else throw new OpError("OP_PATCH", `Patch operation ${i}: op ${op.op} is not add, replace or remove`);
  }
  return d;
}

/* The operation table the studio's room and API expose, by name. */
export const OPERATIONS = {
  setIdentity, setLook, setShell, addRole, removeRole, addRecord, addField, updateField, removeField, removeRecord,
  addRelationship, addDerived, removeDerived, addAccess, addAction, removeAction, putScreen, removeScreen,
  setNavigation, setSamples, setIdentities, makeVariant, applyPatch,
};

export function apply(doc, operation, args) {
  const fn = OPERATIONS[operation];
  need(fn, "OP_UNKNOWN", `Unknown operation ${operation}`);
  return fn(doc, args ?? {});
}

/* Summary of what a definition holds, for panels and the agent's context. */
export function summarize(doc) {
  const idx = indexDefinition(doc);
  return {
    id: doc.id,
    name: idx.app.name,
    version: idx.app.version,
    variantOf: idx.app.variantOf ?? null,
    look: idx.ux.look,
    roles: list(idx.app.roles).map((r) => r.id),
    records: [...idx.records.values()].map((r) => ({ id: r.id, title: r.title, fields: r.fields.map((f) => `${f.name}:${f.scalarType}${f.nullability === "required" ? "" : "?"}`), derived: list(idx.derived.get(refKey(r.ref))).map((x) => x.name) })),
    relationships: [...idx.relationships.values()].map((r) => `${r.source?.element}.${r.fieldName ?? "?"} -> ${r.target?.element}`),
    actions: [...idx.actions.values()].map((a) => ({ id: a.id, name: a.name, roles: a.authorization?.roles ?? [] })),
    screens: list(idx.ux.screens).map((s) => ({ id: s.id, pattern: s.pattern, roles: s.roles ?? [], regions: list(s.regions).map((r) => `${r.kind}:${r.id}`) })),
    navigation: list(idx.ux.shell?.navigation).map((n) => `${n.label} -> ${n.screen}${n.roles ? ` (${n.roles.join(",")})` : ""}`),
    samples: list(idx.app.samples?.records).map((s) => `${s.record.element}: ${s.rows.length}`),
  };
}
