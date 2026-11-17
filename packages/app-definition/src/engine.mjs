/* The app engine: what a definition means at run time, independent of where
   rows live. It computes umf.app derived values, applies umf.app access rules,
   and executes umf.actions recipes (authorization, preconditions, create / set
   / delete effects, link / unlink as foreign-key writes) against a store.

   A store is any object with these async methods (rows are keyed by field name):
     all(recordId)                 -> rows
     insert(recordId, row)         -> void
     update(recordId, key, values) -> void
     remove(recordId, key)         -> void
     transaction(fn)               -> fn's result (optional; atomic when present)
   The studio server's store is Postgres (tables deployed by UMF); the memory
   store below serves tests and in-browser previews. */

import { evaluate, holds, parseRule } from "./expr.mjs";
import { indexDefinition, literalValue, refKey } from "./model.mjs";

const list = (v) => (Array.isArray(v) ? v : []);

export class EngineError extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

/* ---------- reading ---------- */

/* Load every row, compute derived values, and return the rows the identity may
   see, keyed by record id. Derived values may use related(), so all rows are
   loaded before any is computed, and access is applied last (a derived value
   such as an invoice total sums lines the person may not list). */
export async function readSnapshot(idx, store, identity, { now } = {}) {
  const raw = {};
  for (const rec of idx.records.values()) raw[rec.id] = (await store.all(rec.id)).map((r) => ({ ...r }));
  const scope = makeScope(idx, raw, identity, now);
  const computed = {};
  for (const rec of idx.records.values()) computed[rec.id] = raw[rec.id].map((row) => decorate(idx, rec, row, scope));
  // Derived values can read other derived values of related rows: compute in passes until stable (max 3).
  for (let pass = 0; pass < 2; pass++) {
    const s = makeScope(idx, computed, identity, now);
    for (const rec of idx.records.values()) computed[rec.id] = computed[rec.id].map((row) => decorate(idx, rec, row, s));
  }
  const visible = {};
  const s = makeScope(idx, computed, identity, now);
  for (const rec of idx.records.values()) visible[rec.id] = computed[rec.id].filter((row) => canSee(idx, rec, row, identity, s));
  return { records: visible, all: computed, now: s.$now };
}

function decorate(idx, rec, row, scope) {
  const out = { ...row, $key: String(row[rec.keyName]), $record: rec.id };
  for (const d of list(idx.derived.get(refKey(rec.ref)))) {
    try {
      out[d.name] = evaluate(parseRule(d.expression), { ...scope, row: out });
    } catch {
      out[d.name] = null;
    }
  }
  return out;
}

export function makeScope(idx, rowsByRecord, identity, now) {
  const userRow = identity?.key != null && idx.app.identity ? list(rowsByRecord[idx.record(idx.app.identity.record)?.id]).find((r) => String(r[idx.record(idx.app.identity.record).keyName]) === String(identity.key)) : null;
  const user = identity ? { id: identity.id, name: identity.name, email: identity.email, roles: identity.roles, key: identity.key ?? null, ...(identity.attributes ?? {}), row: userRow ?? null } : null;
  return {
    user,
    app: { name: idx.app.name },
    $now: now ?? idx.app.samples?.clock ?? new Date().toISOString(),
    $rows: (recordId) => list(rowsByRecord[idx.recordById(recordId)?.id ?? recordId]),
    $related: (row, name) => related(idx, rowsByRecord, row, name),
  };
}

/* Rows related to `row` through a relationship (by id or name), in either direction. */
export function related(idx, rowsByRecord, row, name) {
  if (!row) return [];
  const rec = idx.recordById(row.$record) ?? [...idx.records.values()].find((r) => r.fields.every((f) => f.name in row));
  if (!rec) return [];
  const rel = idx.relationshipByName(rec.ref, name);
  if (!rel || !rel.fieldName) return [];
  const src = idx.record(rel.source);
  const tgt = idx.record(rel.target);
  if (refKey(rel.source) === refKey(rec.ref)) {
    // many-to-one: the one target row
    const key = row[rel.fieldName];
    return list(rowsByRecord[tgt.id]).filter((r) => String(r[tgt.keyName]) === String(key));
  }
  // one-to-many: source rows pointing at this row
  const key = row[rec.keyName];
  return list(rowsByRecord[src.id]).filter((r) => String(r[rel.fieldName]) === String(key));
}

export function canSee(idx, rec, row, identity, scope) {
  const rules = list(idx.app.access).filter((a) => refKey(a.record) === refKey(rec.ref));
  if (!rules.length) return true;
  const roles = list(identity?.roles);
  return rules.some((a) => a.roles.some((r) => roles.includes(r)) && (!a.when || safeHolds(a.when, { ...scope, row })));
}

const safeHolds = (r, scope) => {
  try {
    return holds(r, scope);
  } catch {
    return false;
  }
};

/* ---------- acting ---------- */

const value = (v) => (v && typeof v === "object" && "parameter" in v ? { parameter: v.parameter } : { literal: literalValue(v?.literal ?? null) });

/* Can the identity run the action at all (authorization only)? */
export function mayRun(idx, actionId, identity) {
  const a = idx.actions.get(actionId);
  if (!a) return false;
  const roles = a.authorization?.kind === "roles" ? list(a.authorization.roles) : [];
  return roles.some((r) => list(identity?.roles).includes(r));
}

/* Check an action without running it: authorization, parameters and
   preconditions. Returns null when it would run, or {code, message, field}. */
export async function checkAction(idx, store, identity, actionId, params, { now, snapshot } = {}) {
  const a = idx.actions.get(actionId);
  if (!a) return { code: "ACTION_UNKNOWN", message: `There is no action ${actionId}` };
  if (!mayRun(idx, actionId, identity)) return { code: "FORBIDDEN", message: `${identity?.name ?? "You"} may not ${a.name.toLowerCase()}` };
  const snap = snapshot ?? (await readSnapshot(idx, store, identity, { now }));
  const resolved = {};
  for (const p of list(a.parameters)) {
    const v = params?.[p.id];
    if (p.kind === "entity") {
      const rec = idx.record(p.target);
      const row = list(snap.records[rec.id]).find((r) => r.$key === String(v));
      if (!row) return { code: "NOT_FOUND", message: `That ${rec.title.toLowerCase()} is not available`, field: p.id };
      resolved[p.id] = row;
    } else {
      const f = idx.field(p.field);
      if (p.required && (v === undefined || v === null || v === "") && !(f && refKey(f.record) && isKeyParam(idx, a, p))) {
        return { code: "REQUIRED", message: `Enter ${f?.title?.toLowerCase() ?? p.id}`, field: p.id };
      }
      if (v != null && v !== "" && f) {
        const bad = typeError(f, v);
        if (bad) return { code: "INVALID", message: bad, field: p.id };
      }
      resolved[p.id] = v;
    }
  }
  const scope = { ...makeScope(idx, snap.all ?? snap.records, identity, snap.now), params: resolved, param: resolved };
  for (const c of list(a.preconditions)) {
    if (!safeHolds(c.rule, scope)) return { code: c.failure?.code ?? "PRECONDITION", message: c.failure?.message ?? `${a.name} is not possible now` };
  }
  return null;
}

const isKeyParam = (idx, a, p) => {
  const create = list(a.binding?.effects).find((e) => e.kind === "create");
  if (!create) return false;
  const rec = idx.record(create.record);
  const f = idx.field(p.field);
  return !!rec && !!f && f.name === rec.keyName;
};

function typeError(f, v) {
  const label = f.title ?? f.name;
  switch (f.scalarType) {
    case "decimal": case "float": case "integer": {
      const n = Number(v);
      if (Number.isNaN(n)) return `${label} must be a number`;
      if (f.scalarType === "integer" && !Number.isInteger(n)) return `${label} must be a whole number`;
      const min = f.facets?.range?.min != null ? literalValue(f.facets.range.min) : null;
      if (min != null && (f.facets.range.minInclusive === false ? n <= min : n < min)) return `${label} must be more than ${min}`;
      return null;
    }
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : `${label} must be a date`;
    case "timestamp": return Number.isNaN(Date.parse(String(v))) ? `${label} must be a date and time` : null;
    case "boolean": return typeof v === "boolean" || v === "true" || v === "false" ? null : `${label} must be yes or no`;
    default:
      if (f.allowedValues.length && !f.allowedValues.includes(v)) return `${label} must be one of ${f.allowedValues.join(", ")}`;
      return null;
  }
}

const coerce = (f, v) => {
  if (v === undefined || v === null || v === "") return null;
  switch (f?.scalarType) {
    case "decimal": case "float": return Number(v);
    case "integer": return Math.trunc(Number(v));
    case "boolean": return v === true || v === "true";
    default: return v;
  }
};

let seq = 0;
export const newKey = (prefix = "r") => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* Run an action. Returns {ok:true, created?, changed} or {ok:false, code, message, field}. */
export async function runAction(idx, store, identity, actionId, params = {}, { now } = {}) {
  const a = idx.actions.get(actionId);
  const p = { ...params };
  // Mint a create's key when nothing supplied it.
  for (const prm of list(a?.parameters)) {
    if (prm.kind === "value" && isKeyParam(idx, a, prm) && (p[prm.id] == null || p[prm.id] === "")) {
      p[prm.id] = newKey(idx.record(list(a.binding.effects).find((e) => e.kind === "create").record).id);
    }
  }
  const work = async () => {
    const problem = await checkAction(idx, store, identity, actionId, p, { now });
    if (problem) return { ok: false, ...problem };
    const changed = [];
    let created;
    const createdKeys = {};
    const paramFields = new Map(list(a.parameters).map((x) => [x.id, x]));
    const resolve = (v, f) => {
      if (v && typeof v === "object" && "parameter" in v) return coerce(f, p[v.parameter]);
      return coerce(f, literalValue(v?.literal ?? null));
    };
    for (const e of list(a.binding?.effects)) {
      if (e.kind === "create") {
        const rec = idx.record(e.record);
        const row = {};
        for (const as of list(e.values)) {
          const f = idx.field(as.field);
          row[f.name] = resolve(as.value, f);
        }
        for (const f of rec.fields) if (!(f.name in row)) row[f.name] = null;
        await store.insert(rec.id, row);
        createdKeys[e.id] = String(row[rec.keyName]);
        created = { record: rec.id, key: String(row[rec.keyName]) };
        changed.push(created);
      } else if (e.kind === "set" || e.kind === "delete") {
        const prm = e.entity?.parameter ? paramFields.get(e.entity.parameter) : null;
        const rec = prm ? idx.record(prm.target) : idx.record(created?.record);
        const key = e.entity?.parameter ? String(p[e.entity.parameter]) : createdKeys[e.entity?.created];
        if (e.kind === "delete") {
          await store.remove(rec.id, key);
        } else {
          const values = {};
          for (const as of list(e.values)) {
            const f = idx.field(as.field);
            values[f.name] = resolve(as.value, f);
          }
          await store.update(rec.id, key, values);
        }
        changed.push({ record: rec.id, key });
      } else if (e.kind === "link" || e.kind === "unlink") {
        const rel = idx.relationships.get(e.relationship?.relationship);
        if (!rel?.fieldName) throw new EngineError("ENGINE_LINK", `Relationship ${e.relationship?.relationship} has no foreign key field`);
        const src = idx.record(rel.source);
        const tgtRec = idx.record(rel.target);
        const srcKey = e.source?.created ? createdKeys[e.source.created] : String(p[e.source?.parameter]);
        const tgtKey = e.target?.created ? createdKeys[e.target.created] : String(p[e.target?.parameter]);
        await store.update(src.id, srcKey, { [rel.fieldName]: e.kind === "link" ? tgtKey : null });
        changed.push({ record: src.id, key: srcKey });
        void tgtRec;
      } else {
        throw new EngineError("ENGINE_EFFECT", `Effect kind ${e.kind} is not supported by app profile 0.1`);
      }
    }
    return { ok: true, ...(created ? { created } : {}), changed };
  };
  if (!a) return { ok: false, code: "ACTION_UNKNOWN", message: `There is no action ${actionId}` };
  return store.transaction ? store.transaction(work) : work();
}

/* ---------- samples ---------- */

/* Rows to seed a store with, from umf.app samples, in dependency order
   (targets of relationships before their sources). */
export function sampleRows(idx) {
  const byRecord = new Map(list(idx.app.samples?.records).map((s) => [refKey(s.record), s.rows]));
  const order = [];
  const seen = new Set();
  const visit = (rec) => {
    if (seen.has(rec.id)) return;
    seen.add(rec.id);
    for (const rel of idx.relationships.values()) if (refKey(rel.source) === refKey(rec.ref)) { const t = idx.record(rel.target); if (t && t.id !== rec.id) visit(t); }
    order.push(rec);
  };
  for (const rec of idx.records.values()) visit(rec);
  // A catalog source's rows are the catalog's, never samples.
  return order.filter((rec) => !idx.sources?.has(rec.id)).map((rec) => ({
    record: rec.id,
    rows: list(byRecord.get(refKey(rec.ref))).map((r) => Object.fromEntries(rec.fields.map((f) => [f.name, coerce(f, r[f.name] ?? null)]))),
  }));
}

/* ---------- a memory store ---------- */

export function memoryStore(idx, seed = sampleRows(idx)) {
  const data = new Map([...idx.records.values()].map((r) => [r.id, []]));
  for (const s of seed) data.set(s.record, s.rows.map((r) => ({ ...r })));
  const keyOf = (recordId) => idx.recordById(recordId).keyName;
  return {
    async all(recordId) { return (data.get(recordId) ?? []).map((r) => ({ ...r })); },
    async insert(recordId, row) {
      const k = keyOf(recordId);
      if ((data.get(recordId) ?? []).some((r) => String(r[k]) === String(row[k]))) throw new EngineError("DUPLICATE_KEY", `${recordId} ${row[k]} already exists`);
      data.get(recordId).push({ ...row });
    },
    async update(recordId, key, values) {
      const k = keyOf(recordId);
      const row = (data.get(recordId) ?? []).find((r) => String(r[k]) === String(key));
      if (!row) throw new EngineError("NOT_FOUND", `${recordId} ${key} does not exist`);
      Object.assign(row, values);
    },
    async remove(recordId, key) {
      const k = keyOf(recordId);
      data.set(recordId, (data.get(recordId) ?? []).filter((r) => String(r[k]) !== String(key)));
    },
    async transaction(fn) {
      const backup = new Map([...data].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
      try {
        return await fn();
      } catch (e) {
        for (const [k, v] of backup) data.set(k, v);
        throw e;
      }
    },
  };
}

/* A complete in-memory host for a definition: what the renderer's DataClient
   needs, for tests and for previews that run entirely in the browser. */
export function memoryHost(doc, { identity, now } = {}) {
  const idx = indexDefinition(doc);
  const store = memoryStore(idx);
  let revision = 0;
  const listeners = new Set();
  const clock = now ?? idx.app.samples?.clock;
  return {
    idx,
    store,
    async snapshot(who = identity) {
      const s = await readSnapshot(idx, store, who, { now: clock });
      return { records: s.records, now: s.now, revision };
    },
    async run(who, action, params) {
      const r = await runAction(idx, store, who, action, params, { now: clock });
      if (r.ok) { revision++; listeners.forEach((l) => l()); }
      return r;
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
}
