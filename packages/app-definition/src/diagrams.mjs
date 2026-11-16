/* Diagrams of an app, derived from its definition: umf.visual 1.1 documents
   that @ux-builder/visuals draws in any theme (SVG, Mermaid, a text version).
   Nothing here is drawn by hand or stored: every diagram is read from the
   definition, so it is always the app as built.

   - data model: an entity-relationship diagram (structure / entities) of the
     records, their fields, keys and relationships;
   - states: for each choice field that actions move (an invoice's status), a
     state machine whose transitions are the actions, with who may run them;
   - flows: for each role, the screens they reach from sign-in through
     navigation, row links and actions (flow / network);
   - access: who may run which action (comparison / matrix);
   - hand-offs: for each state field, the order in which each role acts on the
     record (sequence / lifelines). */

import { humanize, indexDefinition, literalValue, refKey } from "./model.mjs";

const list = (v) => (Array.isArray(v) ? v : []);
/* umf.visual ids: lower-case letters and digits joined by - or _. */
const vid = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
/* "a" or "an" before a word, for the sentences diagrams say about records. */
const aOrAn = (w) => (/^[aeiou]/i.test(String(w).trim()) ? "an" : "a");
const textOf = (t) => (typeof t === "string" ? t : t && typeof t === "object" && "expression" in t ? null : t == null ? null : String(t));

function visual(id, body) {
  return {
    umf: "0.10.0",
    id: `visual:${id}`,
    vocabularies: { "umf.visual": { version: "1.1.0" } },
    extensions: { "umf.visual": { id, ...body } },
    modules: [],
  };
}

const roleNames = (idx, ids) => list(ids).map((r) => idx.roles.get(r)?.name ?? humanize(r));
const actionRoles = (a) => (a?.authorization?.kind === "roles" ? list(a.authorization.roles) : []);

/* ---------- data model ---------- */

function dataModel(idx, appId, name, { derived = false } = {}) {
  const recs = [...idx.records.values()];
  if (!recs.length) return null;
  const fkFields = new Set([...idx.relationships.values()].filter((r) => r.fieldName && r.source).map((r) => `${refKey(r.source)}#${r.fieldName}`));
  const nodes = recs.map((r) => ({ id: vid(r.id), label: r.title, role: "store", ...(r.description ? { detail: r.description } : {}) }));
  const entities = recs.map((r) => ({
    node: vid(r.id),
    fields: [
      ...r.fields.map((f) => {
        const keys = [];
        if (f.name === r.keyName) keys.push("pk");
        if (fkFields.has(`${refKey(r.ref)}#${f.name}`)) keys.push("fk");
        return { name: f.name, type: f.type, ...(keys.length ? { keys } : {}), ...(f.nullability === "nullable" ? { nullable: true } : {}) };
      }),
      // Derived values are computed, never stored: shown on request, with their type marked as such.
      ...(derived ? list(idx.derived.get(refKey(r.ref))).map((d) => ({ name: d.name, type: `derived ${d.format ?? d.scalarType ?? ""}`.trim() })) : []),
    ],
  }));
  const references = [...idx.relationships.values()]
    .filter((rel) => rel.source && rel.target && rel.fieldName)
    .map((rel) => {
      const tgt = idx.record(rel.target);
      const srcField = [...idx.records.values()].find((x) => refKey(x.ref) === refKey(rel.source))?.fields.find((f) => f.name === rel.fieldName);
      return {
        id: vid(rel.id),
        from: { node: vid(rel.source.element), field: rel.fieldName },
        to: { node: vid(rel.target.element), field: tgt?.keyName ?? "id" },
        // Named after what the field points at: "person_id" reads "Person", "owner_id" reads "Owner".
        label: humanize(String(rel.fieldName).replace(/_id$/, "")) || humanize(rel.name ?? rel.id),
        fromCardinality: "zero-or-many",
        toCardinality: srcField?.nullability === "nullable" ? "zero-or-one" : "exactly-one",
      };
    });
  return {
    id: "data-model",
    group: "data",
    title: "Data model",
    description: "Every record the app keeps, its fields and keys, and how records point at each other.",
    doc: visual(`${vid(appId)}-data-model`, {
      kind: "structure",
      form: "entities",
      title: `${name}: data model`,
      question: "What does the app keep, and how do its records relate?",
      takeaway: `${recs.length} record${recs.length === 1 ? "" : "s"} and ${references.length} relationship${references.length === 1 ? "" : "s"}.${derived ? " Derived values are computed per row and never stored." : ""}`,
      audience: "data",
      nodes,
      structure: { entities, ...(references.length ? { references } : {}) },
    }),
  };
}

/* ---------- states ---------- */

/* The values a precondition requires a field of an action's entity to have:
   {"==":[{"var":"params.target.status"},"draft"]}, {"in":[…,["draft","returned"]]},
   {"!=":[…,"paid"]}, found at the top level or inside "and". */
function requiredValues(expr, param, field, all) {
  const isVar = (v) => v && typeof v === "object" && v.var === `params.${param}.${field}`;
  const walk = (e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const [op] = Object.keys(e);
    const args = list(e[op]);
    if (op === "and") {
      let out = null;
      for (const a of args) {
        const r = walk(a);
        if (r) out = out ? out.filter((x) => r.includes(x)) : r;
      }
      return out;
    }
    if (op === "==" && args.length === 2) {
      if (isVar(args[0]) && typeof args[1] !== "object") return [String(args[1])];
      if (isVar(args[1]) && typeof args[0] !== "object") return [String(args[0])];
    }
    if (op === "!=" && args.length === 2 && isVar(args[0]) && typeof args[1] !== "object") return all.filter((v) => v !== String(args[1]));
    if (op === "in" && args.length === 2 && isVar(args[0]) && Array.isArray(args[1])) return args[1].map(String);
    return null;
  };
  return walk(expr);
}
const parse = (rule) => {
  try {
    return JSON.parse(rule?.expression ?? "null");
  } catch {
    return null;
  }
};

/* Each choice field that some action sets to a fixed value, with its transitions. */
function stateFields(idx) {
  const out = [];
  for (const rec of idx.records.values()) {
    for (const f of rec.fields) {
      const values = f.allowedValues.map(String);
      if (values.length < 2) continue;
      let initial = null;
      const transitions = [];
      for (const a of idx.actions.values()) {
        for (const e of list(a.binding?.effects)) {
          const set = list(e.values).find((v) => refKey(v.field) === refKey(f.ref) && v.value && "literal" in v.value);
          if (!set) continue;
          const to = String(literalValue(set.value.literal));
          if (!values.includes(to)) continue;
          if (e.kind === "create" && refKey(e.record) === refKey(rec.ref)) {
            initial ??= to;
            continue;
          }
          if (e.kind !== "set") continue;
          const param = e.entity?.parameter;
          let from = null;
          for (const p of list(a.preconditions)) {
            const r = requiredValues(parse(p.rule), param, f.name, values);
            if (r) from = from ? from.filter((x) => r.includes(x)) : r;
          }
          for (const s of from ?? values.filter((v) => v !== to)) {
            if (s !== to) transitions.push({ action: a, from: s, to, guarded: !!from });
          }
        }
      }
      if (transitions.length) out.push({ rec, field: f, values, initial: initial ?? values[0], transitions });
    }
  }
  return out;
}

function stateDiagram(idx, appId, s) {
  const order = (v) => s.values.indexOf(v);
  const reachable = new Set([s.initial, ...s.transitions.map((t) => t.to)]);
  const states = s.values.filter((v) => reachable.has(v) || s.transitions.some((t) => t.from === v));
  const outgoing = new Set(s.transitions.map((t) => t.from));
  const final = states.filter((v) => !outgoing.has(v));
  const label = `${s.rec.title} ${s.field.title.toLowerCase()}`;
  return {
    id: `state-${vid(s.rec.id)}-${vid(s.field.name)}`,
    group: "states",
    title: `${s.rec.title}: ${s.field.title.toLowerCase()}`,
    description: `How ${aOrAn(s.rec.title)} ${s.rec.title.toLowerCase()} moves from ${humanize(s.initial).toLowerCase()} to ${final.map((v) => humanize(v).toLowerCase()).join(" or ") || "its other states"}, and who moves it.`,
    doc: visual(`${vid(appId)}-${vid(s.rec.id)}-${vid(s.field.name)}-states`, {
      kind: "state",
      form: "machine",
      title: label[0].toUpperCase() + label.slice(1),
      question: `What can ${aOrAn(s.rec.title)} ${s.rec.title.toLowerCase()}'s ${s.field.title.toLowerCase()} be, and what changes it?`,
      takeaway: `It starts as ${humanize(s.initial).toLowerCase()}. Each arrow is an action, with the roles that may run it.`,
      audience: "user",
      nodes: states.map((v) => ({ id: vid(v), label: humanize(v) })),
      state: {
        initial: vid(s.initial),
        ...(final.length ? { final: final.map(vid) } : {}),
        transitions: s.transitions.map((t, i) => ({
          id: `t${i + 1}-${vid(t.action.id)}`,
          from: vid(t.from),
          to: vid(t.to),
          event: t.action.name ?? humanize(t.action.id),
          ...(actionRoles(t.action).length ? { guard: roleNames(idx, actionRoles(t.action)).join(", ") } : {}),
          // A move back to an earlier state (a return, a reopen) is the alternate path.
          path: order(t.to) < order(t.from) ? "alternate" : "main",
        })),
      },
    }),
    states: s,
  };
}

/* ---------- flows ---------- */

const visibleTo = (screen, role) => !list(screen.roles).length || list(screen.roles).includes(role);

/* The screens a screen leads to: row links, links in values, and actions that
   open a screen after they run. Labels say how. */
function exits(idx, screen) {
  const out = [];
  const seen = new Set();
  const add = (to, label) => {
    if (!to || to === screen.id || !idx.screens.has(to)) return;
    const k = `${to}|${label}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ to, label });
  };
  const walk = (node, ctx) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ctx));
    if (!node || typeof node !== "object") return;
    const here = node.action ? (node.label ? textOf(node.label) : null) ?? idx.actions.get(node.action)?.name ?? humanize(node.action) : ctx;
    for (const [k, v] of Object.entries(node)) {
      if (k === "back" || k === "param") continue;
      if ((k === "navigate" || k === "link" || k === "open" || k === "then") && v && typeof v === "object" && typeof v.screen === "string") add(v.screen, here ?? "opens a row");
      else if (k === "screen" && typeof v === "string" && node !== screen) add(v, here ?? "opens");
      else walk(v, here);
    }
  };
  walk({ ...screen, id: undefined }, null);
  return out;
}

function flowDiagram(idx, appId, role) {
  const nav = list(idx.ux.shell?.navigation).filter((n) => !list(n.roles).length || list(n.roles).includes(role.id));
  const home = list(idx.ux.shell?.home).find((h) => list(h.roles).includes(role.id))?.screen;
  const screens = [...idx.screens.values()].filter((s) => visibleTo(s, role.id));
  if (!screens.length) return null;
  const ids = new Set(screens.map((s) => s.id));
  const actor = `who-${vid(role.id)}`;
  const nodes = [
    { id: actor, label: role.name, detail: "signs in", role: "actor" },
    ...screens.map((s) => ({ id: vid(s.id), label: textOf(s.title) ?? humanize(s.id), detail: `${s.pattern} screen`, role: "own" })),
  ];
  const edges = [];
  const seen = new Set();
  const edge = (from, to, label, kind = "action") => {
    const id = `${from}--${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, from, to, label, kind });
  };
  const navLabel = (n) => `menu: ${textOf(n.label) ?? humanize(n.id)}`;
  if (home && ids.has(home)) {
    const n = nav.find((x) => x.screen === home);
    edge(actor, vid(home), n ? `starts here · ${navLabel(n)}` : "starts here", "control");
  }
  for (const n of nav) if (ids.has(n.screen)) edge(actor, vid(n.screen), navLabel(n), "control");
  for (const s of screens) for (const x of exits(idx, s)) if (ids.has(x.to)) edge(vid(s.id), vid(x.to), x.label);
  return {
    id: `flow-${vid(role.id)}`,
    group: "flows",
    title: `${role.name}: screens and paths`,
    description: `The screens ${role.name.toLowerCase()} reaches after signing in, through the menu, row links and actions.`,
    doc: visual(`${vid(appId)}-${vid(role.id)}-flow`, {
      kind: "flow",
      form: "network",
      title: `${role.name}: what they can reach`,
      question: `Where can ${role.name.toLowerCase()} go in the app, and how?`,
      takeaway: `${screens.length} screen${screens.length === 1 ? "" : "s"}; ${nav.length} in the menu.`,
      audience: "user",
      nodes,
      edges,
    }),
  };
}

/* ---------- access ---------- */

function accessMatrix(idx, appId, name) {
  const actions = [...idx.actions.values()];
  const roles = [...idx.roles.values()];
  // Roles are the columns and actions the rows, so a long list of actions reads down the page.
  if (!actions.length || roles.length < 2) return null;
  return {
    id: "access",
    group: "access",
    title: "Who can do what",
    description: "Every action in the app, and which roles may run it.",
    doc: visual(`${vid(appId)}-access`, {
      kind: "comparison",
      form: "matrix",
      title: `${name}: who can do what`,
      question: "Which roles may run each action?",
      audience: "user",
      comparison: {
        items: roles.map((r) => ({ id: vid(`role-${r.id}`), label: r.name })),
        criteria: actions.map((a) => ({ id: vid(`action-${a.id}`), label: a.name ?? humanize(a.id), measure: "support" })),
        values: actions.flatMap((a) => roles.map((r) => ({ item: vid(`role-${r.id}`), criterion: vid(`action-${a.id}`), support: actionRoles(a).includes(r.id) ? "yes" : "no" }))),
      },
    }),
  };
}

/* ---------- hand-offs ---------- */

function handoffSequence(idx, appId, s) {
  // The main path from the initial state, in order, then the alternates.
  const main = [];
  const used = new Set();
  let at = s.initial;
  for (let guard = 0; guard < 20; guard++) {
    const next = s.transitions.find((t) => t.from === at && !used.has(t) && s.values.indexOf(t.to) > s.values.indexOf(t.from));
    if (!next) break;
    used.add(next);
    main.push(next);
    at = next.to;
  }
  // Then every other move (returns, reopenings, side paths), in the order of the states they leave.
  const rest = s.transitions.filter((t) => !used.has(t)).sort((a, b) => s.values.indexOf(a.from) - s.values.indexOf(b.from) || s.values.indexOf(a.to) - s.values.indexOf(b.to));
  const steps = [...main, ...rest];
  const roles = [...new Set(steps.flatMap((t) => actionRoles(t.action)))];
  if (!steps.length || !roles.length) return null;
  const rec = `rec-${vid(s.rec.id)}`;
  return {
    id: `handoff-${vid(s.rec.id)}-${vid(s.field.name)}`,
    group: "flows",
    title: `${s.rec.title}: who acts, in order`,
    description: `The journey of ${aOrAn(s.rec.title)} ${s.rec.title.toLowerCase()} between people: each step is an action and the state it leaves the ${s.rec.title.toLowerCase()} in.`,
    doc: visual(`${vid(appId)}-${vid(s.rec.id)}-handoff`, {
      kind: "sequence",
      form: "lifelines",
      title: `${aOrAn(s.rec.title) === "an" ? "An" : "A"} ${s.rec.title.toLowerCase()}'s journey`,
      question: `Who acts on ${aOrAn(s.rec.title)} ${s.rec.title.toLowerCase()}, and in what order?`,
      takeaway: `Main path: ${[s.initial, ...main.map((t) => t.to)].map((v) => humanize(v).toLowerCase()).join(" → ")}.`,
      audience: "user",
      sequence: {
        participants: [...roles.map((r) => ({ id: `role-${vid(r)}`, label: idx.roles.get(r)?.name ?? humanize(r), role: "actor" })), { id: rec, label: s.rec.title, role: "store" }],
        messages: steps.map((t, i) => {
          const who = actionRoles(t.action)[0];
          return {
            id: `m${i + 1}`,
            from: `role-${vid(who)}`,
            to: rec,
            label: `${t.action.name ?? humanize(t.action.id)} → ${humanize(t.to).toLowerCase()}`,
            kind: main.includes(t) ? "call" : "async",
          };
        }),
      },
    }),
  };
}

/* ---------- all of them ---------- */

/** Every diagram the definition supports, in reading order: [{ id, group, title, description, doc }].
    options.derived shows derived values in the data model. */
export function appDiagrams(doc, options = {}) {
  const idx = indexDefinition(doc);
  const appId = doc?.id ?? "app";
  const name = idx.app?.name ?? humanize(appId);
  const states = stateFields(idx);
  const diagrams = [
    dataModel(idx, appId, name, options),
    ...states.map((s) => stateDiagram(idx, appId, s)),
    ...states.map((s) => handoffSequence(idx, appId, s)),
    ...[...idx.roles.values()].map((r) => flowDiagram(idx, appId, r)),
    accessMatrix(idx, appId, name),
  ].filter(Boolean);
  return diagrams.map(({ states: _s, ...d }) => d);
}

export const DIAGRAM_GROUPS = [
  { id: "data", label: "Data model" },
  { id: "states", label: "States" },
  { id: "flows", label: "Flows and journeys" },
  { id: "access", label: "Access" },
];
