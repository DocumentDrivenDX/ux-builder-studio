/* The app definition's expression language ("umf.app.expr", version 1).

   A rule is UMF's own rule shape ({language, version, expression, references}),
   with `expression` holding a JSON-encoded expression tree. An expression is a
   literal (string, number, boolean, null), an array of expressions, or an object
   with exactly one operator key whose value is its arguments, as in JSON Logic:

     {"==": [{"var": "row.status"}, "draft"]}
     {"sum": [{"related": "lines"}, "amount"]}

   The language is closed: unknown operators are errors at validation time
   (checkExpression) and at evaluation time. It has no loops, no assignment and
   no access to anything but the scope it is given, so a definition can never
   run code. The same evaluator runs in the browser and on the server. */

export const EXPR_LANGUAGE = "umf.app.expr";
export const EXPR_VERSION = "1";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* Operators: arity [min, max] (max -1 = any) and a one-line description, which
   the agent's knowledge and the validator both use. */
export const OPERATORS = {
  var: [1, 2, "Read a value from scope by dotted path, e.g. row.status, user.id, params.invoice, record.hours, outer.id (the enclosing row inside rows/related/filter/map/some/all); optional default."],
  "==": [2, 2, "Equal (strict, after normalising numbers given as strings)."],
  "!=": [2, 2, "Not equal."],
  "<": [2, 2, "Less than (numbers, ISO dates and times compare as strings)."],
  "<=": [2, 2, "Less than or equal."],
  ">": [2, 2, "Greater than."],
  ">=": [2, 2, "Greater than or equal."],
  and: [1, -1, "True when every argument is truthy."],
  or: [1, -1, "True when any argument is truthy."],
  not: [1, 1, "Logical negation."],
  if: [3, 3, "if(condition, then, else)."],
  in: [2, 2, "Membership: value in array, or substring in string."],
  "+": [1, -1, "Sum of numbers."],
  "-": [1, 2, "Subtract, or negate one number."],
  "*": [2, -1, "Product of numbers."],
  "/": [2, 2, "Divide (division by zero gives null)."],
  round: [1, 2, "Round to n decimal places (default 0)."],
  cat: [1, -1, "Concatenate as text."],
  coalesce: [1, -1, "The first argument that is not null or empty."],
  present: [1, 1, "True when the value is not null, undefined or an empty string."],
  related: [1, 2, "Rows of the current row's relationship (by relationship id or name); optional filter expression applied to each related row (as row)."],
  rows: [1, 2, "All visible rows of a record (by record id); optional filter expression applied to each row (as row)."],
  filter: [2, 2, "Keep the array items for which the expression (evaluated with the item as row) is truthy."],
  map: [2, 2, "Map array items through an expression (item as row)."],
  sum: [1, 2, "Sum an array of numbers, or of a field of each item."],
  count: [1, 1, "Number of items in an array."],
  first: [1, 1, "The first item of an array (null when empty)."],
  distinct: [1, 1, "The array without repeated values."],
  lower: [1, 1, "Lower-case text."],
  join: [1, 2, "Join an array's items as text with a separator (default \", \")."],
  "short-date": [1, 1, "A date as people read it in a list: 9 Nov (or 9 Nov 2025 outside the current year)."],
  min: [1, 2, "Smallest number in an array (or of a field of each item)."],
  max: [1, 2, "Largest number in an array (or of a field of each item)."],
  some: [2, 2, "True when the expression holds for some item (item as row)."],
  all: [2, 2, "True when the expression holds for every item (item as row)."],
  today: [0, 0, "Today's date (YYYY-MM-DD) in the scope's clock."],
  now: [0, 0, "The current instant (ISO timestamp) in the scope's clock."],
  date: [1, 1, "The date part (YYYY-MM-DD) of a timestamp or date."],
  "add-days": [2, 2, "add-days(date, n): a date n days later."],
  "start-of-week": [1, 1, "The Monday of the date's week (YYYY-MM-DD)."],
  hours: [2, 2, "hours(start, end): the decimal hours between two timestamps."],
};

export class ExprError extends Error {
  constructor(code, message, path = "") {
    super(message);
    this.code = code;
    this.path = path;
  }
}

/* Parse a rule's expression string, or pass an already-parsed tree through. */
export function parseRule(rule) {
  if (rule == null) return null;
  if (isObj(rule) && typeof rule.expression === "string") {
    if (rule.language !== EXPR_LANGUAGE) throw new ExprError("EXPR_LANGUAGE", `Unsupported expression language ${rule.language}@${rule.version}; expected ${EXPR_LANGUAGE}@${EXPR_VERSION}`);
    if (rule.version !== EXPR_VERSION) throw new ExprError("EXPR_VERSION", `Unsupported ${EXPR_LANGUAGE} version ${rule.version}`);
    try {
      return JSON.parse(rule.expression);
    } catch (e) {
      throw new ExprError("EXPR_JSON", `Expression is not valid JSON: ${e.message}`);
    }
  }
  return rule;
}

/* Build a rule from a tree (the shape UMF's umf.actions conditions use). */
export function rule(tree, references = []) {
  return { language: EXPR_LANGUAGE, version: EXPR_VERSION, expression: JSON.stringify(tree), references };
}

/* Static check: every operator is known and has a valid arity. Returns
   [{path, message}] (empty when valid). `vars` (optional) is a set of allowed
   top-level scope names, so `{"var": "rowz.x"}` is caught before it runs. */
export function checkExpression(tree, { vars = null, path = "" } = {}) {
  const out = [];
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}/${i}`));
    if (!isObj(node)) return;
    const keys = Object.keys(node);
    if (keys.length !== 1) return out.push({ path: at, message: `An operator object needs exactly one key, found ${keys.length}` });
    const op = keys[0];
    const spec = OPERATORS[op];
    if (!spec) return out.push({ path: at, message: `Unknown operator "${op}"` });
    const args = Array.isArray(node[op]) ? node[op] : [node[op]];
    const n = node[op] === null && op !== "var" ? 0 : args.length;
    const [min, max] = spec;
    if (op === "today" || op === "now") {
      // {"today": []} or {"today": null}
    } else if (n < min || (max !== -1 && n > max)) {
      out.push({ path: at, message: `"${op}" takes ${min}${max === -1 ? "+" : max === min ? "" : `–${max}`} argument(s), got ${n}` });
    }
    if (op === "var" && vars && typeof args[0] === "string") {
      const head = args[0].split(".")[0];
      if (!vars.has(head)) out.push({ path: at, message: `Unknown variable "${head}" (available: ${[...vars].join(", ")})` });
    }
    args.forEach((a, i) => walk(a, `${at}/${op}/${i}`));
  };
  walk(tree, path);
  return out;
}

const num = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v == null ? 0 : NaN;
};
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
const norm = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
const get = (obj, path) => {
  let cur = obj;
  for (const part of String(path).split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
};
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toDate = (v) => {
  if (v instanceof Date) return v;
  const s = String(v);
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
};

/* Evaluate. `scope` holds named values (row, user, params, record…), plus:
     scope.$related(row, relationship) -> rows   (data access for `related`)
     scope.$rows(recordId) -> rows               (data access for `rows`)
     scope.$now -> ISO timestamp                 (the clock; defaults to real time) */
export function evaluate(tree, scope = {}) {
  const ev = (node, sc) => {
    if (Array.isArray(node)) return node.map((n) => ev(n, sc));
    if (!isObj(node)) return node;
    const [op] = Object.keys(node);
    const raw = node[op];
    const args = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const A = (i) => ev(args[i], sc);
    const withRow = (row) => ({ ...sc, row, item: row, outer: sc.row });
    const field = (items, f) => (f == null ? items : items.map((x) => (typeof f === "string" ? get(x, f) : ev(f, withRow(x)))));
    switch (op) {
      case "var": {
        const v = get(sc, A(0));
        return v === undefined && args.length > 1 ? A(1) : v;
      }
      case "==": return norm(A(0)) === norm(A(1));
      case "!=": return norm(A(0)) !== norm(A(1));
      case "<": case "<=": case ">": case ">=": {
        let a = A(0), b = A(1);
        if (typeof a !== "string" || typeof b !== "string") { a = num(a); b = num(b); }
        return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
      }
      case "and": { let v = true; for (const a of args) { v = ev(a, sc); if (!truthy(v)) return v; } return v; }
      case "or": { let v = false; for (const a of args) { v = ev(a, sc); if (truthy(v)) return v; } return v; }
      case "not": return !truthy(A(0));
      case "if": return truthy(A(0)) ? A(1) : A(2);
      case "in": { const b = A(1); const a = A(0); return Array.isArray(b) ? b.map(norm).includes(norm(a)) : typeof b === "string" ? b.includes(String(a)) : false; }
      case "+": return args.reduce((s, _, i) => s + num(A(i)), 0);
      case "-": return args.length === 1 ? -num(A(0)) : num(A(0)) - num(A(1));
      case "*": return args.reduce((s, _, i) => s * num(A(i)), 1);
      case "/": { const d = num(A(1)); return d === 0 ? null : num(A(0)) / d; }
      case "round": { const p = Math.pow(10, args.length > 1 ? num(A(1)) : 0); return Math.round((num(A(0)) + Number.EPSILON) * p) / p; }
      case "cat": return args.map((_, i) => { const v = A(i); return v == null ? "" : String(v); }).join("");
      case "coalesce": { for (let i = 0; i < args.length; i++) { const v = A(i); if (v != null && v !== "") return v; } return null; }
      case "present": { const v = A(0); return v != null && v !== "" && !(Array.isArray(v) && v.length === 0); }
      case "related": {
        if (typeof sc.$related !== "function") throw new ExprError("EXPR_SCOPE", "related needs a data scope");
        const rows = sc.$related(sc.row, A(0)) ?? [];
        return args.length > 1 ? rows.filter((r) => truthy(ev(args[1], withRow(r)))) : rows;
      }
      case "rows": {
        if (typeof sc.$rows !== "function") throw new ExprError("EXPR_SCOPE", "rows needs a data scope");
        const rows = sc.$rows(A(0)) ?? [];
        return args.length > 1 ? rows.filter((r) => truthy(ev(args[1], withRow(r)))) : rows;
      }
      case "filter": return (A(0) ?? []).filter((x) => truthy(ev(args[1], withRow(x))));
      case "map": return (A(0) ?? []).map((x) => ev(args[1], withRow(x)));
      case "sum": return field(A(0) ?? [], args[1] === undefined ? undefined : typeof args[1] === "string" ? args[1] : args[1]).reduce((s, v) => s + num(v), 0);
      case "count": return (A(0) ?? []).length;
      case "first": { const a = A(0); return Array.isArray(a) && a.length ? a[0] : null; }
      case "distinct": { const a = A(0) ?? []; return [...new Set(a.map((v) => (v != null && typeof v === "object" ? JSON.stringify(v) : v)))].map((v) => (typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : v)); }
      case "join": { const a = A(0) ?? []; return a.filter((v) => v != null && v !== "").join(args.length > 1 ? String(A(1)) : ", "); }
      case "lower": { const v = A(0); return v == null ? v : String(v).toLowerCase(); }
      case "short-date": {
        const v = A(0);
        if (v == null || v === "") return null;
        const d = toDate(String(v).slice(0, 10));
        const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const year = (sc.$now ?? new Date().toISOString()).slice(0, 4);
        return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()) === year ? "" : ` ${d.getUTCFullYear()}`}`;
      }
      case "min": case "max": {
        const raw = field(A(0) ?? [], args[1]).filter((v) => v != null && v !== "");
        if (raw.length && raw.every((v) => typeof v === "string" && Number.isNaN(Number(v)))) {
          // Dates and times (ISO strings) compare as text.
          return raw.reduce((a, b) => ((op === "min" ? b < a : b > a) ? b : a));
        }
        const vs = raw.map(num).filter((v) => !Number.isNaN(v));
        return vs.length ? (op === "min" ? Math.min(...vs) : Math.max(...vs)) : null;
      }
      case "some": return (A(0) ?? []).some((x) => truthy(ev(args[1], withRow(x))));
      case "all": return (A(0) ?? []).every((x) => truthy(ev(args[1], withRow(x))));
      case "today": return (sc.$now ?? new Date().toISOString()).slice(0, 10);
      case "now": return sc.$now ?? new Date().toISOString();
      case "date": { const v = A(0); return v == null ? null : String(v).slice(0, 10); }
      case "add-days": { const d = toDate(A(0)); d.setUTCDate(d.getUTCDate() + num(A(1))); return isoDate(d); }
      case "start-of-week": { const d = toDate(A(0)); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return isoDate(d); }
      case "hours": { const a = toDate(A(0)), b = toDate(A(1)); return Math.round(((b - a) / 36e5) * 100) / 100; }
      default: throw new ExprError("EXPR_OPERATOR", `Unknown operator "${op}"`);
    }
  };
  return ev(tree, scope);
}

/* Evaluate a UMF rule (or a tree) to a boolean. */
export const holds = (r, scope) => truthy(evaluate(parseRule(r), scope));
