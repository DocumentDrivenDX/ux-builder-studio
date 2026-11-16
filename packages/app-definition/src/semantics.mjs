/* Semantic validators for umf.app 0.1 and umf.ux 0.1, registered with a UMF
   Registry (UMF calls them after the JSON Schema passes). They resolve every
   reference against the whole document and check ux-builder's static UX rules
   on the declaration, so a definition that would render broken, unreachable or
   unsafe screens is invalid before anything renders. Each diagnostic names a
   ux-builder rule where one applies (`rule`), so the agent can explain it. */

import { checkExpression, parseRule, ExprError } from "./expr.mjs";
import { indexDefinition, refKey } from "./model.mjs";

const list = (v) => (Array.isArray(v) ? v : []);
const SCOPE_VARS = ["row", "item", "outer", "user", "params", "param", "record", "selection", "input", "app"];

function exprDiagnostics(r, path, add, vars = SCOPE_VARS) {
  if (r == null || typeof r === "string") return;
  let tree;
  try {
    tree = parseRule(r);
  } catch (e) {
    return add(e instanceof ExprError ? e.code : "EXPR_INVALID", `${path}/expression`, e.message);
  }
  for (const p of checkExpression(tree, { vars: new Set(vars) })) add("EXPR_INVALID", `${path}/expression${p.path}`, p.message);
}

export function appSemantics(value, context) {
  const out = [];
  const add = (code, path, message, severity = "error") => out.push({ code, path: context.path + path, message, severity });
  const idx = indexDefinition(context.document);
  const roleIds = new Set(list(value.roles).map((r) => r.id));
  const seen = new Set();
  list(value.roles).forEach((r, i) => {
    if (seen.has(r.id)) add("APP_ROLE_DUPLICATE", `/roles/${i}/id`, `Role ${r.id} is declared twice`);
    seen.add(r.id);
  });
  if (value.identity && !idx.record(value.identity.record)) add("APP_REF", "/identity/record", `Identity record ${refKey(value.identity.record)} is not a record in this document`);

  const derivedIds = new Set();
  list(value.derived).forEach((d, i) => {
    const at = `/derived/${i}`;
    if (derivedIds.has(d.id)) add("APP_DERIVED_DUPLICATE", `${at}/id`, `Derived value ${d.id} is declared twice`);
    derivedIds.add(d.id);
    const rec = idx.record(d.record);
    if (!rec) return add("APP_REF", `${at}/record`, `Record ${refKey(d.record)} does not exist`);
    if (rec.fields.some((f) => f.name === d.name)) add("APP_DERIVED_SHADOWS", `${at}/name`, `${d.name} is already a field of ${rec.name}; derived values need their own name`);
    exprDiagnostics(d.expression, `${at}/expression`, add);
  });

  list(value.access).forEach((a, i) => {
    const at = `/access/${i}`;
    if (!idx.record(a.record)) add("APP_REF", `${at}/record`, `Record ${refKey(a.record)} does not exist`);
    list(a.roles).forEach((r, j) => { if (!roleIds.has(r)) add("APP_ROLE_UNKNOWN", `${at}/roles/${j}`, `Role ${r} is not declared in umf.app roles`); });
    exprDiagnostics(a.when, `${at}/when`, add);
  });

  list(value.foreignKeys).forEach((fk, i) => {
    const at = `/foreignKeys/${i}`;
    const rel = idx.relationships.get(fk.relationship);
    if (!rel) return add("APP_REF", `${at}/relationship`, `Relationship ${fk.relationship} does not exist`);
    const f = idx.field(fk.field);
    if (!f) return add("APP_REF", `${at}/field`, `Field ${refKey(fk.field)} is not a member of any record`);
    if (refKey(f.record) !== refKey(rel.source)) add("APP_FK_OWNER", `${at}/field`, `${f.name} belongs to ${f.record.element}, but relationship ${rel.id} starts at ${rel.source?.element}`);
  });
  for (const rel of idx.relationships.values()) {
    if (!list(value.foreignKeys).some((fk) => fk.relationship === rel.id)) add("APP_FK_MISSING", "/foreignKeys", `Relationship ${rel.id} has no foreign key field; name the field of ${rel.source?.element} that holds the ${rel.target?.element} key`);
  }

  // Samples: rows must use the record's field names; keys must be unique.
  list(value.samples?.records).forEach((s, i) => {
    const rec = idx.record(s.record);
    const at = `/samples/records/${i}`;
    if (!rec) return add("APP_REF", `${at}/record`, `Record ${refKey(s.record)} does not exist`);
    const names = new Set(rec.fields.map((f) => f.name));
    const keys = new Set();
    list(s.rows).forEach((row, j) => {
      for (const k of Object.keys(row)) if (!names.has(k)) add("APP_SAMPLE_FIELD", `${at}/rows/${j}/${k}`, `${rec.name} has no field ${k}`);
      for (const f of rec.fields) if (f.nullability === "required" && (row[f.name] === undefined || row[f.name] === null)) add("APP_SAMPLE_REQUIRED", `${at}/rows/${j}`, `${rec.name} row ${j} is missing required ${f.name}`);
      const key = row[rec.keyName];
      if (keys.has(key)) add("APP_SAMPLE_KEY", `${at}/rows/${j}/${rec.keyName}`, `${rec.name} key ${key} is used twice`);
      keys.add(key);
      for (const f of rec.fields) {
        if (f.allowedValues.length && row[f.name] != null && !f.allowedValues.includes(row[f.name])) add("APP_SAMPLE_VALUE", `${at}/rows/${j}/${f.name}`, `${row[f.name]} is not an allowed ${f.name} (${f.allowedValues.join(", ")})`);
      }
    });
  });
  list(value.samples?.identities).forEach((p, i) => {
    list(p.roles).forEach((r, j) => { if (!roleIds.has(r)) add("APP_ROLE_UNKNOWN", `/samples/identities/${i}/roles/${j}`, `Role ${r} is not declared`); });
  });

  // Action authorization roles must be app roles.
  for (const a of idx.actions.values()) {
    for (const r of list(a.authorization?.kind === "roles" ? a.authorization.roles : [])) {
      if (!roleIds.has(r)) add("APP_ROLE_UNKNOWN", "/roles", `Action ${a.id} authorizes role ${r}, which is not declared in umf.app roles`);
    }
  }
  return out;
}

export function uxSemantics(value, context) {
  const out = [];
  const add = (code, path, message, severity = "error", rule) => out.push({ code, path: context.path + path, message: rule ? `${message} [${rule}]` : message, severity });
  const idx = indexDefinition(context.document);
  const roleIds = new Set(list(idx.app.roles).map((r) => r.id));
  const screens = list(value.screens);
  const screenIds = new Set();
  screens.forEach((s, i) => {
    if (screenIds.has(s.id)) add("UX_SCREEN_DUPLICATE", `/screens/${i}/id`, `Screen ${s.id} is declared twice`);
    screenIds.add(s.id);
  });
  const roleList = (roles, at) => list(roles).forEach((r, j) => { if (!roleIds.has(r)) add("UX_ROLE_UNKNOWN", `${at}/${j}`, `Role ${r} is not declared in umf.app roles`); });
  const screenRoles = (s) => (list(s?.roles).length ? list(s.roles) : [...roleIds]);
  const reached = new Set();

  const checkNavigate = (nav, at, from) => {
    if (!nav) return;
    if (!screenIds.has(nav.screen)) return add("UX_SCREEN_UNKNOWN", `${at}/screen`, `Screen ${nav.screen} does not exist`);
    reached.add(nav.screen);
    const target = idx.screens.get(nav.screen);
    if (target?.param && !nav.param) add("UX_PARAM_MISSING", at, `Screen ${nav.screen} needs its ${target.param.id} parameter`, "error", "flow.target-exists");
    exprDiagnostics(nav.param, `${at}/param`, add);
    if (from && target) {
      const lost = screenRoles(from).filter((r) => !screenRoles(target).includes(r));
      if (lost.length && list(from.roles).length === 0 && list(target.roles).length) {
        add("UX_DEAD_END", at, `Roles ${lost.join(", ")} can see ${from.id} but not ${target.id}; hide the link for them or widen ${target.id}`, "warning", "flow.no-dead-end");
      }
    }
  };
  const checkValue = (v, at, rec) => {
    if (!v) return;
    const kinds = ["field", "derived", "value"].filter((k) => v[k] != null);
    if (kinds.length !== 1) return add("UX_VALUE_SHAPE", at, `A value names exactly one of field, derived or value (found ${kinds.join(", ") || "none"})`);
    if (v.field) {
      const f = idx.field(v.field);
      if (!f) add("UX_REF", `${at}/field`, `Field ${refKey(v.field)} does not exist`);
      else if (rec && refKey(f.record) !== refKey(rec)) add("UX_FIELD_RECORD", `${at}/field`, `${f.name} belongs to ${f.record.element}, not ${rec.element}`);
    }
    if (v.derived) {
      const ds = rec ? list(idx.derived.get(refKey(rec))) : [];
      if (!ds.some((d) => d.id === v.derived)) add("UX_REF", `${at}/derived`, `Derived value ${v.derived} is not declared for ${rec?.element ?? "this record"}`);
    }
    exprDiagnostics(v.value, `${at}/value`, add);
    exprDiagnostics(v.secondary, `${at}/secondary`, add);
    if (v.link) checkNavigate(v.link, `${at}/link`);
  };
  const checkPlacement = (p, at, screen, ctxRecord) => {
    const a = idx.actions.get(p.action);
    if (!a) return add("UX_ACTION_UNKNOWN", `${at}/action`, `Action ${p.action} is not declared in umf.actions`);
    roleList(p.roles, `${at}/roles`);
    exprDiagnostics(p.when, `${at}/when`, add);
    const params = new Map(list(a.parameters).map((x) => [x.id, x]));
    const bound = new Set();
    list(p.bind).forEach((b, j) => {
      if (!params.has(b.parameter)) add("UX_PARAM_UNKNOWN", `${at}/bind/${j}/parameter`, `Action ${a.id} has no parameter ${b.parameter}`);
      if (b.from === "value") exprDiagnostics(b.value, `${at}/bind/${j}/value`, add);
      if (b.from === "param" && !screen?.param) add("UX_PARAM_MISSING", `${at}/bind/${j}`, `Screen ${screen?.id} has no parameter to bind ${b.parameter} from`);
      if (b.from === "row" && !ctxRecord) add("UX_BIND_ROW", `${at}/bind/${j}`, `${b.parameter} is bound from the row, but this placement is not on a row`);
      bound.add(b.parameter);
    });
    list(p.inputs).forEach((c, j) => {
      if (!params.has(c.parameter)) add("UX_PARAM_UNKNOWN", `${at}/inputs/${j}/parameter`, `Action ${a.id} has no parameter ${c.parameter}`);
      bound.add(c.parameter);
    });
    for (const prm of params.values()) {
      if (prm.required && !bound.has(prm.id) && prm.kind === "entity") add("UX_PARAM_UNBOUND", at, `Required parameter ${prm.id} of ${a.id} is neither bound nor an input`);
    }
    const destructive = p.emphasis === "destructive" || list(a.binding?.effects).some((e) => e.kind === "delete");
    if (destructive && !p.confirm) add("UX_CONFIRM_MISSING", at, `${a.name ?? a.id} deletes or cannot be undone; ask for confirmation`, "error", "action.destructive-safeguard");
    // Role consistency: a placement shown to roles the action does not authorize.
    const authz = a.authorization?.kind === "roles" ? list(a.authorization.roles) : null;
    if (authz) {
      const shownTo = list(p.roles).length ? list(p.roles) : screenRoles(screen);
      const blocked = shownTo.filter((r) => !authz.includes(r));
      if (blocked.length) add("UX_ROLE_ACTION", at, `${a.name ?? a.id} is shown to ${blocked.join(", ")}, who may not run it; restrict the placement's roles to ${authz.join(", ")}`);
    }
    checkNavigate(p.success?.navigate, `${at}/success/navigate`, screen);
  };

  // Shell and navigation.
  list(value.shell?.navigation).forEach((n, i) => {
    const at = `/shell/navigation/${i}`;
    if (!screenIds.has(n.screen)) add("UX_SCREEN_UNKNOWN", `${at}/screen`, `Screen ${n.screen} does not exist`);
    else {
      reached.add(n.screen);
      const s = idx.screens.get(n.screen);
      if (s?.param) add("UX_NAV_PARAM", `${at}/screen`, `${n.screen} needs a parameter, so it cannot be a navigation destination`, "error", "flow.target-exists");
    }
    roleList(n.roles, `${at}/roles`);
  });
  list(value.shell?.home).forEach((h, i) => {
    if (!screenIds.has(h.screen)) add("UX_SCREEN_UNKNOWN", `/shell/home/${i}/screen`, `Screen ${h.screen} does not exist`);
    reached.add(h.screen);
    roleList(h.roles, `/shell/home/${i}/roles`);
  });
  for (const r of roleIds) {
    const navFor = list(value.shell?.navigation).filter((n) => !list(n.roles).length || list(n.roles).includes(r));
    if (!navFor.length) add("UX_ROLE_NO_NAV", "/shell/navigation", `Role ${r} has no navigation destination`);
  }

  screens.forEach((s, i) => {
    const at = `/screens/${i}`;
    roleList(s.roles, `${at}/roles`);
    if (s.param && !idx.record(s.param.record)) add("UX_REF", `${at}/param/record`, `Record ${refKey(s.param.record)} does not exist`);
    checkNavigate(s.back, `${at}/back`, s);
    list(s.actions).forEach((p, j) => checkPlacement(p, `${at}/actions/${j}`, s, s.param?.record));
    const regionIds = new Set();
    list(s.regions).forEach((r, j) => {
      const rat = `${at}/regions/${j}`;
      if (regionIds.has(r.id)) add("UX_REGION_DUPLICATE", `${rat}/id`, `Region ${r.id} is declared twice on ${s.id}`);
      regionIds.add(r.id);
      roleList(r.roles, `${rat}/roles`);
      exprDiagnostics(r.when, `${rat}/when`, add);
      exprDiagnostics(r.filter, `${rat}/filter`, add);
      const needRecord = ["collection", "schedule"].includes(r.kind);
      if (needRecord && !r.record) add("UX_REGION_RECORD", rat, `A ${r.kind} region needs a record`);
      if (r.record && !idx.record(r.record)) add("UX_REF", `${rat}/record`, `Record ${refKey(r.record)} does not exist`);
      if (["record", "related", "document"].includes(r.kind) && !s.param) add("UX_PARAM_MISSING", rat, `A ${r.kind} region shows one row, so screen ${s.id} needs a parameter`);
      const rowRecord = r.kind === "related" ? idx.relationshipByName(s.param?.record, r.relationship)?.source : r.record ?? s.param?.record;
      if (r.kind === "related") {
        const rel = idx.relationshipByName(s.param?.record, r.relationship);
        if (!rel) add("UX_REF", `${rat}/relationship`, `Relationship ${r.relationship} does not exist from ${s.param?.record?.element}`);
      }
      list(r.columns).forEach((c, k) => checkValue(c, `${rat}/columns/${k}`, rowRecord));
      list(r.fields).forEach((c, k) => checkValue(c, `${rat}/fields/${k}`, r.kind === "record" || r.kind === "document" ? s.param?.record : rowRecord));
      list(r.totals).forEach((c, k) => checkValue(c, `${rat}/totals/${k}`, r.kind === "record" || r.kind === "document" ? s.param?.record : rowRecord));
      list(r.rowActions).forEach((p, k) => checkPlacement(p, `${rat}/rowActions/${k}`, s, rowRecord));
      list(r.bulkActions).forEach((p, k) => checkPlacement(p, `${rat}/bulkActions/${k}`, s, null));
      list(r.eventActions).forEach((p, k) => checkPlacement(p, `${rat}/eventActions/${k}`, s, rowRecord));
      list(r.items).forEach((p, k) => checkPlacement(p, `${rat}/items/${k}`, s, s.param?.record));
      if (r.rowLink) checkNavigate(r.rowLink, `${rat}/rowLink`, s);
      if (["collection", "related", "schedule"].includes(r.kind) && !r.empty) add("UX_EMPTY_STATE", rat, `${r.kind} region ${r.id} has no empty state; say what appears here and how to add it`, "error", "screen.states");
      if (r.kind === "collection" && !list(r.columns).length) add("UX_COLUMNS", rat, `Collection region ${r.id} has no columns`);
      if (r.kind === "schedule") {
        for (const k of ["start", "end"]) {
          const f = r[k] && idx.field(r[k]);
          if (!f) add("UX_REF", `${rat}/${k}`, `A schedule region needs a ${k} field`);
          else if (!["timestamp"].includes(f.scalarType)) add("UX_SCHEDULE_TYPE", `${rat}/${k}`, `${f.name} is ${f.scalarType}; a schedule needs timestamps`);
        }
        checkValue(r.label, `${rat}/label`, r.record);
        if (r.colorBy) checkValue(r.colorBy, `${rat}/colorBy`, r.record);
      }
      if (r.kind === "form") {
        const a = idx.actions.get(r.action);
        if (!a) add("UX_ACTION_UNKNOWN", `${rat}/action`, `Action ${r.action} is not declared in umf.actions`);
        else checkPlacement({ action: r.action, bind: r.bind, inputs: r.inputs, success: r.success }, rat, s, s.param?.record);
      }
      if (r.kind === "stats") list(r.tiles).forEach((t, k) => exprDiagnostics(t.value, `${rat}/tiles/${k}/value`, add));
      if (r.kind === "notice" && !r.message && !r.title) add("UX_NOTICE_TEXT", rat, "A notice needs a title or a message");
      list(r.sections).forEach((sec, k) => {
        const sat = `${rat}/sections/${k}`;
        let secRec = s.param?.record;
        if (sec.relationship) {
          const rel = idx.relationshipByName(s.param?.record, sec.relationship);
          if (!rel) add("UX_REF", `${sat}/relationship`, `Relationship ${sec.relationship} does not exist from ${s.param?.record?.element}`);
          secRec = rel?.source;
        }
        list(sec.fields).forEach((c, m) => checkValue(c, `${sat}/fields/${m}`, s.param?.record));
        list(sec.columns).forEach((c, m) => checkValue(c, `${sat}/columns/${m}`, secRec));
        list(sec.totals).forEach((c, m) => checkValue(c, `${sat}/totals/${m}`, s.param?.record));
        list(sec.rowActions).forEach((p, m) => checkPlacement(p, `${sat}/rowActions/${m}`, s, secRec));
      });
    });
  });
  screens.forEach((s, i) => {
    if (!reached.has(s.id)) add("UX_UNREACHABLE", `/screens/${i}`, `Screen ${s.id} cannot be reached from navigation, home or any link`, "warning", "flow.reachable");
  });
  return out;
}
