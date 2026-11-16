/* Read an app definition (a UMF document) into an index the renderer, the
   runtime, the validator and the agent all share. Nothing here mutates the
   document. A row is a plain object keyed by each field's `name` (its column
   name), which is unique within its record. */

export const UX = "umf.ux";
export const APP = "umf.app";
export const ACTIONS = "umf.actions";

const list = (v) => (Array.isArray(v) ? v : []);
export const refKey = (r) => (r && r.module && r.element ? `${r.module}/${r.element}` : "");
export const sameRef = (a, b) => refKey(a) !== "" && refKey(a) === refKey(b);

export function indexDefinition(doc) {
  const modules = list(doc?.modules);
  const elements = new Map(); // "module/element" -> element
  const records = new Map(); // "module/element" -> record info
  const fields = new Map(); // "module/element" -> field info (with owning record)
  const relationships = new Map(); // id -> relationship info
  const actions = new Map(); // id -> umf.actions action (+ module)

  const app = doc?.extensions?.[APP] ?? {};
  const ux = doc?.extensions?.[UX] ?? {};
  const fieldTypes = app.fieldTypes ?? {};
  for (const m of modules) {
    for (const e of list(m?.elements)) elements.set(`${m.id}/${e.id}`, { ...e, module: m.id });
  }
  for (const m of modules) {
    for (const e of list(m?.elements)) {
      if (e.kind !== "record") continue;
      const ref = { module: m.id, element: e.id };
      const members = list(e.members).map((mr) => {
        const fe = elements.get(refKey(mr));
        const info = {
          ref: { module: mr.module, element: mr.element },
          id: mr.element,
          name: fe?.name ?? mr.element,
          title: fe?.title ?? humanize(fe?.name ?? mr.element),
          description: fe?.description,
          scalarType: fe?.scalarType ?? "string",
          type: fieldTypes[mr.element] ?? defaultType(fe?.scalarType),
          nullability: fe?.nullability ?? "unspecified",
          allowedValues: list(fe?.allowedValues).map(literalValue),
          facets: fe?.facets ?? {},
          semanticTypes: list(fe?.semanticTypes),
          record: ref,
        };
        fields.set(refKey(mr), info);
        return info;
      });
      const pk = list(e.keys).find((k) => k.primary) ?? list(e.keys)[0];
      const keyField = pk ? fields.get(refKey(pk.fields?.[0])) : members[0];
      records.set(refKey(ref), {
        ref,
        id: e.id,
        name: e.name ?? e.id,
        title: e.title ?? e.name ?? humanize(e.id),
        description: e.description,
        fields: members,
        keyName: keyField?.name ?? "id",
      });
    }
    for (const r of list(m?.relationships)) {
      relationships.set(r.id, {
        id: r.id,
        name: r.name,
        module: m.id,
        source: r.source?.[0] ? { module: r.source[0].module, element: r.source[0].element } : null,
        target: r.target?.[0] ? { module: r.target[0].module, element: r.target[0].element } : null,
        sourceMultiplicity: r.sourceMultiplicity,
        targetMultiplicity: r.targetMultiplicity,
        inverse: r.inverse,
      });
    }
    for (const a of list(m?.extensions?.[ACTIONS]?.actions)) actions.set(a.id, { ...a, module: m.id });
  }

  // Foreign keys: which field of the source record holds the target's key.
  for (const fk of list(app.foreignKeys)) {
    const rel = relationships.get(fk.relationship);
    const f = fields.get(refKey(fk.field));
    if (rel && f) rel.fieldName = f.name;
  }

  const derived = new Map(); // "module/element" -> [{id, name, ...}]
  for (const d of list(app.derived)) {
    const k = refKey(d.record);
    if (!derived.has(k)) derived.set(k, []);
    derived.get(k).push(d);
  }

  const screens = new Map(list(ux.screens).map((s) => [s.id, s]));
  const roles = new Map(list(app.roles).map((r) => [r.id, r]));

  return {
    doc,
    app,
    ux,
    elements,
    records,
    fields,
    relationships,
    actions,
    derived,
    screens,
    roles,
    record: (r) => records.get(typeof r === "string" ? r : refKey(r)),
    field: (r) => fields.get(typeof r === "string" ? r : refKey(r)),
    recordById: (id) => [...records.values()].find((x) => x.id === id || x.name === id),
    relationshipByName: (from, name) =>
      relationships.get(name) ??
      [...relationships.values()].find((x) => x.name === name && (sameRef(x.source, from) || sameRef(x.target, from))),
  };
}

/* A UMF literal ({string: "x"}, {integerToken: "3"}, …) as a JS value. */
export function literalValue(lit) {
  if (lit == null || typeof lit !== "object") return lit ?? null;
  if ("string" in lit) return lit.string;
  if ("boolean" in lit) return lit.boolean;
  if ("integerToken" in lit) return Number(lit.integerToken);
  if ("decimalToken" in lit) return Number(lit.decimalToken);
  if ("floatToken" in lit) return Number(lit.floatToken);
  if ("date" in lit) return lit.date;
  if ("timestamp" in lit) return lit.timestamp;
  if ("time" in lit) return lit.time;
  if ("uuid" in lit) return lit.uuid;
  return null;
}

/* A JS value as a UMF literal for a scalar type. */
export function toLiteral(value, scalarType = "string") {
  if (value == null) return null;
  switch (scalarType) {
    case "boolean": return { boolean: !!value };
    case "integer": return { integerToken: String(Math.trunc(Number(value))) };
    case "decimal": return { decimalToken: String(value) };
    case "float": return { floatToken: String(value) };
    case "date": return { date: String(value) };
    case "timestamp": return { timestamp: String(value) };
    case "time": return { time: String(value) };
    case "uuid": return { uuid: String(value) };
    default: return { string: String(value) };
  }
}

export function defaultType(scalarType) {
  return { integer: "integer", decimal: "number", float: "number", boolean: "boolean", date: "date", time: "time", timestamp: "datetime" }[scalarType] ?? "text";
}

export function humanize(id) {
  const s = String(id ?? "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
