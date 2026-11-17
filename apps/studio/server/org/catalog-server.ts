/* The local data catalog: a stand-in for a Databricks workspace's Unity
   Catalog, so the studio's catalog connector can be tried and tested on one
   machine. It answers the parts of Unity Catalog's REST API the connector
   uses (catalogs, schemas, tables with their columns, constraints, row
   filters and column masks, functions, effective permissions) and the SQL
   Statement Execution API for the statements the connector sends, in the
   same shapes Databricks does.

   Every call carries the person's own access token from the sign-in (a JWT
   for this catalog's audience), and runs as that person: each person is a
   PostgreSQL role in their groups' roles, tables are granted to groups,
   row filters are row-level security policies, and column masks are applied
   by a view the reads go through. So what the catalog refuses here, it
   refuses because PostgreSQL does, not because the studio decided to. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { GROUPS, ORG, PEOPLE, SCHEMAS, SPEC_VERSION, personByEmail, sampleData, type ColumnSpec, type TableSpec } from "./sample-org.js";

type Pg = { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>; exec(sql: string): Promise<unknown>; close(): Promise<void> };

export const CATALOG_AUDIENCE = "urn:ux-builder-studio:catalog";
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pgSchema = (schema: string) => `${ORG.catalog}__${schema}`;
const groupRole = (g: string) => `g_${g.replace(/-/g, "_")}`;
const personRole = (id: string) => `u_${id}`;
const PG_TYPE: Record<ColumnSpec["type"], string> = { STRING: "text", INT: "integer", "DECIMAL(12,2)": "numeric(12,2)", "DECIMAL(6,2)": "numeric(6,2)", DATE: "date", TIMESTAMP: "timestamptz", BOOLEAN: "boolean" };
const TYPE_NAME = (t: ColumnSpec["type"]) => t.replace(/\(.*$/, "");

function findTable(fullName: string): { schema: (typeof SCHEMAS)[number]; table: TableSpec } | null {
  const [cat, sch, tbl] = String(fullName).split(".");
  if (cat !== ORG.catalog) return null;
  const schema = SCHEMAS.find((s) => s.name === sch);
  const table = schema?.tables.find((t) => t.name === tbl);
  return schema && table ? { schema, table } : null;
}

/* ---------- building the database ---------- */

async function build(db: Pg) {
  const groups = GROUPS.map((g) => g.id);
  const stmts: string[] = [
    `CREATE SCHEMA IF NOT EXISTS uc_meta`,
    `CREATE TABLE IF NOT EXISTS uc_meta.version (spec text primary key)`,
    `CREATE SCHEMA sec`,
    `GRANT USAGE ON SCHEMA sec TO PUBLIC`,
    ...groups.map((g) => `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(groupRole(g))}) THEN CREATE ROLE ${q(groupRole(g))} NOLOGIN; END IF; END $$`),
    ...PEOPLE.map((p) => `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(personRole(p.id))}) THEN CREATE ROLE ${q(personRole(p.id))} NOLOGIN; END IF; END $$`),
    ...PEOPLE.flatMap((p) => p.groups.map((g) => `GRANT ${q(groupRole(g))} TO ${q(personRole(p.id))}`)),
    // The caller's membership of a group (the role exists and the caller is in it).
    `CREATE FUNCTION sec.role_in_group(r text, g text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g_' || replace(g, '-', '_')) AND pg_has_role(r, 'g_' || replace(g, '-', '_'), 'member') $$`,
    `CREATE FUNCTION sec.in_group(g text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT sec.role_in_group(current_user::text, g) $$`,
  ];
  for (const s of SCHEMAS) {
    const ps = pgSchema(s.name);
    stmts.push(`CREATE SCHEMA ${q(ps)}`, `COMMENT ON SCHEMA ${q(ps)} IS ${lit(s.comment)}`);
    for (const g of s.use) stmts.push(`GRANT USAGE ON SCHEMA ${q(ps)} TO ${q(groupRole(g))}`);
    for (const t of s.tables) {
      const cols = t.columns.map((c) => `${q(c.name)} ${PG_TYPE[c.type]}${c.nullable === false ? " NOT NULL" : ""}${c.values ? ` CHECK (${q(c.name)} IN (${c.values.map(lit).join(", ")}))` : ""}`);
      stmts.push(`CREATE TABLE ${q(ps)}.${q(t.name)} (${cols.join(", ")}, PRIMARY KEY (${q(t.primaryKey)}))`, `COMMENT ON TABLE ${q(ps)}.${q(t.name)} IS ${lit(t.comment)}`);
      for (const c of t.columns) stmts.push(`COMMENT ON COLUMN ${q(ps)}.${q(t.name)}.${q(c.name)} IS ${lit(c.comment)}`);
    }
  }
  // A matter's time is visible to the matter's practice group (reads matters as the catalog's owner, so no policy recursion).
  stmts.push(`CREATE FUNCTION sec.matter_in_my_group(m text, r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM ${q(pgSchema("practice"))}.matters x WHERE x.matter_id = m AND sec.role_in_group(r, x.practice_group)) $$`);
  for (const s of SCHEMAS) {
    const ps = pgSchema(s.name);
    for (const t of s.tables) {
      const table = `${q(ps)}.${q(t.name)}`;
      for (const g of t.select) stmts.push(`GRANT SELECT ON ${table} TO ${q(groupRole(g))}`);
      for (const g of t.modify) stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${q(groupRole(g))}`);
      if (t.rowFilter) {
        stmts.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, `CREATE POLICY ${q(t.rowFilter.function)} ON ${table} USING (${t.rowFilter.sql}) WITH CHECK (${t.rowFilter.sql})`);
      }
      // Reads go through a view that applies the column masks, as the caller (security_invoker), so grants and row filters still apply.
      const select = t.columns.map((c) => (c.mask ? `CASE WHEN ${c.mask.visibleTo.map((g) => `sec.in_group(${lit(g)})`).join(" OR ")} THEN ${q(c.name)} ELSE NULL END AS ${q(c.name)}` : q(c.name)));
      stmts.push(`CREATE VIEW ${q(ps)}.${q(`${t.name}__read`)} WITH (security_invoker = true) AS SELECT ${select.join(", ")} FROM ${table}`);
      for (const g of new Set([...t.select, ...t.modify])) stmts.push(`GRANT SELECT ON ${q(ps)}.${q(`${t.name}__read`)} TO ${q(groupRole(g))}`);
    }
  }
  for (const s of stmts) await db.exec(s);
  const data = sampleData();
  for (const s of SCHEMAS) {
    for (const t of s.tables) {
      const rows = data[`${s.name}.${t.name}`] ?? [];
      const cols = t.columns.map((c) => c.name);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const params: unknown[] = [];
        const values = chunk.map((row) => `(${cols.map((c) => { params.push(row[c] ?? null); return `$${params.length}`; }).join(", ")})`);
        await db.query(`INSERT INTO ${q(pgSchema(s.name))}.${q(t.name)} (${cols.map(q).join(", ")}) VALUES ${values.join(", ")}`, params);
      }
    }
  }
  await db.query(`INSERT INTO uc_meta.version (spec) VALUES ($1)`, [SPEC_VERSION]);
}

async function open(dir: string | null): Promise<Pg> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) mkdirSync(dir, { recursive: true });
  const db = (dir ? new PGlite(dir) : new PGlite()) as any;
  await db.waitReady;
  const current = await db.query(`SELECT spec FROM uc_meta.version`).then((r: any) => r.rows[0]?.spec).catch(() => null);
  if (current !== SPEC_VERSION) {
    if (current) {
      // An older sample organisation: start again from the current spec.
      await db.close();
      const { rmSync } = await import("node:fs");
      rmSync(dir!, { recursive: true, force: true });
      return open(dir);
    }
    await build(db);
  }
  return db;
}

/* ---------- serving it ---------- */

class UcError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Caller = { email: string; role: string };

/* Run fn as the caller's PostgreSQL role, or as the catalog's owner (null).
   PGlite is one connection, so every use of it takes its turn. */
function asCaller(db: Pg) {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(caller: Caller | null, fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(async () => {
      if (!caller) return fn();
      await db.exec(`SET ROLE ${q(caller.role)}`);
      try { return await fn(); } finally { await db.exec(`RESET ROLE`); }
    });
    chain = next.catch(() => {});
    return next;
  };
}

export async function startCatalogServer({ port, issuer, dataDir }: { port: number; issuer: string; dataDir: string | null }) {
  const db = await open(dataDir ? join(dataDir, "catalog-pg") : null);
  const run = asCaller(db);
  const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  const caller = async (req: Request): Promise<Caller> => {
    const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    if (!token) throw new UcError(401, "UNAUTHENTICATED", "Credential was not sent or was of an unsupported type for this API.");
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: CATALOG_AUDIENCE }).catch(() => { throw new UcError(401, "UNAUTHENTICATED", "Invalid access token."); });
    const person = personByEmail(String(payload.email ?? ""));
    if (!person) throw new UcError(403, "PERMISSION_DENIED", "The token's user is not a member of this workspace.");
    return { email: person.email, role: personRole(person.id) };
  };
  const route = (fn: (req: Request, who: Caller) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    caller(req).then((who) => fn(req, who)).then((body) => res.json(body)).catch(next);

  const may = async (_who: Caller, sql: string, params: unknown[]) => (await run(null, () => db.query<{ ok: boolean }>(sql, params))).rows[0]?.ok === true;
  const canUseSchema = (who: Caller, schema: string) => may(who, `SELECT has_schema_privilege($1, $2, 'USAGE') AS ok`, [who.role, pgSchema(schema)]);
  const privileges = async (who: Caller, schema: string, table: string) => {
    const t = `${q(pgSchema(schema))}.${q(table)}`;
    if (!(await canUseSchema(who, schema))) return [] as string[];
    const out: string[] = [];
    if (await may(who, `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [who.role, t])) out.push("SELECT");
    if (await may(who, `SELECT has_table_privilege($1, $2, 'INSERT') AND has_table_privilege($1, $2, 'UPDATE') AND has_table_privilege($1, $2, 'DELETE') AS ok`, [who.role, t])) out.push("MODIFY");
    return out;
  };

  const tableInfo = (schema: string, t: TableSpec) => ({
    name: t.name,
    catalog_name: ORG.catalog,
    schema_name: schema,
    full_name: `${ORG.catalog}.${schema}.${t.name}`,
    table_type: "MANAGED",
    data_source_format: "DELTA",
    comment: t.comment,
    owner: "data-platform",
    columns: t.columns.map((c, i) => ({
      name: c.name,
      type_text: c.type.toLowerCase(),
      type_name: TYPE_NAME(c.type),
      position: i,
      nullable: c.nullable !== false,
      comment: c.comment,
      ...(c.mask ? { mask: { function_name: `${ORG.catalog}.security.${c.mask.function}`, using_column_names: [] } } : {}),
    })),
    ...(t.rowFilter ? { row_filter: { function_name: `${ORG.catalog}.security.${t.rowFilter.function}`, input_column_names: t.rowFilter.columns } } : {}),
    table_constraints: [
      { primary_key_constraint: { name: `${t.name}_pk`, child_columns: [t.primaryKey] } },
      ...(t.foreignKeys ?? []).map((fk) => ({ foreign_key_constraint: { name: `${t.name}_${fk.column}_fk`, child_columns: [fk.column], parent_table: `${ORG.catalog}.${fk.references}`, parent_columns: [fk.parentColumn] } })),
    ],
    // Delta keeps CHECK constraints as table properties.
    properties: Object.fromEntries(t.columns.filter((c) => c.values).map((c) => [`delta.constraints.${c.name}_valid`, `${c.name} IN (${c.values!.map((v) => `'${v}'`).join(", ")})`])),
  });

  const UC = "/api/2.1/unity-catalog";
  app.get(`${UC}/catalogs`, route(async () => ({ catalogs: [{ name: ORG.catalog, full_name: ORG.catalog, comment: `${ORG.name}: the firm's data`, owner: "data-platform", catalog_type: "MANAGED_CATALOG" }] })));
  app.get(`${UC}/catalogs/:name`, route(async (req) => {
    if (req.params.name !== ORG.catalog) throw new UcError(404, "CATALOG_DOES_NOT_EXIST", `Catalog '${req.params.name}' does not exist.`);
    return { name: ORG.catalog, full_name: ORG.catalog, comment: `${ORG.name}: the firm's data`, owner: "data-platform" };
  }));
  app.get(`${UC}/schemas`, route(async (req, who) => {
    if (req.query.catalog_name !== ORG.catalog) throw new UcError(404, "CATALOG_DOES_NOT_EXIST", `Catalog '${req.query.catalog_name}' does not exist.`);
    const schemas = [];
    for (const s of SCHEMAS) if (await canUseSchema(who, s.name)) schemas.push({ name: s.name, catalog_name: ORG.catalog, full_name: `${ORG.catalog}.${s.name}`, comment: s.comment, owner: "data-platform" });
    return { schemas };
  }));
  app.get(`${UC}/tables`, route(async (req, who) => {
    const s = req.query.catalog_name === ORG.catalog ? SCHEMAS.find((x) => x.name === req.query.schema_name) : null;
    if (!s || !(await canUseSchema(who, s.name))) throw new UcError(404, "SCHEMA_DOES_NOT_EXIST", `Schema '${req.query.catalog_name}.${req.query.schema_name}' does not exist.`);
    const tables = [];
    for (const t of s.tables) if ((await privileges(who, s.name, t.name)).length) tables.push(tableInfo(s.name, t));
    return { tables };
  }));
  app.get(`${UC}/tables/:full_name`, route(async (req, who) => {
    const found = findTable(String(req.params.full_name));
    if (!found || !(await privileges(who, found.schema.name, found.table.name)).length) throw new UcError(404, "TABLE_DOES_NOT_EXIST", `Table '${req.params.full_name}' does not exist.`);
    return tableInfo(found.schema.name, found.table);
  }));
  app.get(`${UC}/functions/:full_name`, route(async (req) => {
    const name = String(req.params.full_name).split(".").pop();
    for (const s of SCHEMAS) for (const t of s.tables) {
      if (t.rowFilter?.function === name) return { name, full_name: req.params.full_name, catalog_name: ORG.catalog, schema_name: "security", comment: t.rowFilter!.comment, routine_body: "SQL" };
      for (const c of t.columns) if (c.mask?.function === name) return { name, full_name: req.params.full_name, catalog_name: ORG.catalog, schema_name: "security", comment: c.mask!.comment, routine_body: "SQL" };
    }
    throw new UcError(404, "ROUTINE_DOES_NOT_EXIST", `Routine '${req.params.full_name}' does not exist.`);
  }));
  app.get(`${UC}/effective-permissions/:type/:full_name`, route(async (req, who) => {
    const principal = String(req.query.principal ?? who.email);
    if (principal.toLowerCase() !== who.email.toLowerCase()) throw new UcError(403, "PERMISSION_DENIED", "Only the principal or an owner may read these permissions.");
    if (req.params.type !== "table") throw new UcError(400, "INVALID_PARAMETER_VALUE", "Only table permissions are available here.");
    const found = findTable(String(req.params.full_name));
    if (!found) throw new UcError(404, "TABLE_DOES_NOT_EXIST", `Table '${req.params.full_name}' does not exist.`);
    const privs = await privileges(who, found.schema.name, found.table.name);
    if (!privs.length) throw new UcError(404, "TABLE_DOES_NOT_EXIST", `Table '${req.params.full_name}' does not exist.`);
    const person = personByEmail(who.email)!;
    const via = (p: string) => (p === "SELECT" ? found.table.select : found.table.modify).find((g) => person.groups.includes(g));
    return { privilege_assignments: [{ principal: who.email, privileges: [...privs, "USE_SCHEMA", "USE_CATALOG"].map((p) => ({ privilege: p, inherited_from_type: p.startsWith("USE") ? (p === "USE_SCHEMA" ? "SCHEMA" : "CATALOG") : "TABLE", inherited_from_name: via(p) ?? null })) }] };
  }));

  /* The SQL Statement Execution API, for the statements the connector sends. */
  app.post("/api/2.0/sql/statements", route(async (req, who) => {
    const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { sql, params, kind, columns } = translate(String(req.body?.statement ?? ""), req.body?.parameters ?? []);
      const res = await run(who, () => db.query(sql, params));
      if (kind === "select") {
        return {
          statement_id: id,
          status: { state: "SUCCEEDED" },
          manifest: { format: "JSON_ARRAY", schema: { column_count: columns.length, columns: columns.map((c, i) => ({ name: c.name, type_name: TYPE_NAME(c.type), position: i })) }, total_row_count: res.rows.length },
          result: { row_count: res.rows.length, data_array: res.rows.map((r: any) => columns.map((c) => text(r[c.name], c.type))) },
        };
      }
      return { statement_id: id, status: { state: "SUCCEEDED" }, manifest: { format: "JSON_ARRAY", schema: { column_count: 1, columns: [{ name: "num_affected_rows", type_name: "LONG", position: 0 }] } }, result: { row_count: 1, data_array: [[String(res.affectedRows ?? 0)]] } };
    } catch (e: any) {
      const denied = /permission denied|row-level security/i.test(e?.message ?? "");
      return { statement_id: id, status: { state: "FAILED", error: { error_code: denied ? "PERMISSION_DENIED" : e instanceof UcError ? e.code : "BAD_REQUEST", message: denied ? `[INSUFFICIENT_PERMISSIONS] Insufficient privileges: ${e.message}` : String(e?.message ?? e) } } };
    }
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof UcError) return res.status(err.status).json({ error_code: err.code, message: err.message });
    console.error(err);
    res.status(500).json({ error_code: "INTERNAL_ERROR", message: String((err as Error)?.message ?? err) });
  });

  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(port, "127.0.0.1", () => resolve(s)); });
  return { url: `http://127.0.0.1:${port}`, close: async () => { server.close(); await db.close(); } };
}

const text = (v: unknown, type: ColumnSpec["type"]): string | null => {
  if (v == null) return null;
  if (type === "DATE") return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  if (type === "TIMESTAMP") return v instanceof Date ? v.toISOString() : String(v);
  if (type === "BOOLEAN") return v ? "true" : "false";
  return String(v);
};

/* The statements the connector sends, in Databricks SQL, as PostgreSQL:
     SELECT `a`, `b` FROM `cat`.`schema`.`table` [LIMIT n]
     INSERT INTO `cat`.`schema`.`table` (`a`, `b`) VALUES (:p0, :p1)
     UPDATE `cat`.`schema`.`table` SET `a` = :p0 WHERE `k` = :key
     DELETE FROM `cat`.`schema`.`table` WHERE `k` = :key
   Anything else is refused. Reads go through the masking view; writes go to the table. */
function translate(statement: string, parameters: Array<{ name: string; value: string | null; type?: string }>) {
  const s = statement.trim().replace(/;$/, "");
  const name3 = "`([^`]+)`\\.`([^`]+)`\\.`([^`]+)`";
  const values = new Map(parameters.map((p) => [p.name, p.value]));
  const table = (c: string, sc: string, t: string) => {
    const found = findTable(`${c}.${sc}.${t}`);
    if (!found) throw new UcError(404, "TABLE_OR_VIEW_NOT_FOUND", `[TABLE_OR_VIEW_NOT_FOUND] The table or view ${c}.${sc}.${t} cannot be found.`);
    return found;
  };
  const column = (t: TableSpec, n: string) => {
    const c = t.columns.find((x) => x.name === n);
    if (!c) throw new UcError(400, "UNRESOLVED_COLUMN", `[UNRESOLVED_COLUMN] A column named ${n} cannot be resolved.`);
    return c;
  };
  const params: unknown[] = [];
  const param = (name: string, c: ColumnSpec) => {
    if (!values.has(name)) throw new UcError(400, "UNBOUND_SQL_PARAMETER", `[UNBOUND_SQL_PARAMETER] Found the unbound parameter: ${name}.`);
    params.push(values.get(name));
    return `$${params.length}::${PG_TYPE[c.type]}`;
  };
  const cols = (list: string) => list.split(",").map((x) => /^`([^`]+)`$/.exec(x.trim())?.[1]).map((x) => { if (!x) throw new UcError(400, "PARSE_SYNTAX_ERROR", "[PARSE_SYNTAX_ERROR] Unexpected column list."); return x; });

  let m = new RegExp(`^SELECT (.+) FROM ${name3}(?: LIMIT (\\d+))?$`, "is").exec(s);
  if (m) {
    const { schema, table: t } = table(m[2], m[3], m[4]);
    const columns = cols(m[1]).map((n) => column(t, n));
    return { kind: "select" as const, columns, params, sql: `SELECT ${columns.map((c) => q(c.name)).join(", ")} FROM ${q(pgSchema(schema.name))}.${q(`${t.name}__read`)} ORDER BY ${q(t.primaryKey)}${m[5] ? ` LIMIT ${Number(m[5])}` : ""}` };
  }
  m = new RegExp(`^INSERT INTO ${name3} \\((.+)\\) VALUES \\((.+)\\)$`, "is").exec(s);
  if (m) {
    const { schema, table: t } = table(m[1], m[2], m[3]);
    const names = cols(m[4]);
    const ps = m[5].split(",").map((x) => /^:([A-Za-z0-9_]+)$/.exec(x.trim())?.[1]);
    if (ps.length !== names.length || ps.some((x) => !x)) throw new UcError(400, "PARSE_SYNTAX_ERROR", "[PARSE_SYNTAX_ERROR] VALUES must name one parameter per column.");
    const placeholders = names.map((n, i) => param(ps[i]!, column(t, n)));
    return { kind: "dml" as const, columns: [], params, sql: `INSERT INTO ${q(pgSchema(schema.name))}.${q(t.name)} (${names.map(q).join(", ")}) VALUES (${placeholders.join(", ")})` };
  }
  m = new RegExp(`^UPDATE ${name3} SET (.+) WHERE \`([^\`]+)\` = :([A-Za-z0-9_]+)$`, "is").exec(s);
  if (m) {
    const { schema, table: t } = table(m[1], m[2], m[3]);
    const sets = m[4].split(",").map((x) => /^`([^`]+)` = :([A-Za-z0-9_]+)$/.exec(x.trim())).map((x) => { if (!x) throw new UcError(400, "PARSE_SYNTAX_ERROR", "[PARSE_SYNTAX_ERROR] SET must assign parameters."); return x; });
    const assigned = sets.map((x) => `${q(column(t, x[1]).name)} = ${param(x[2], column(t, x[1]))}`);
    const key = column(t, m[5]);
    return { kind: "dml" as const, columns: [], params, sql: `UPDATE ${q(pgSchema(schema.name))}.${q(t.name)} SET ${assigned.join(", ")} WHERE ${q(key.name)} = ${param(m[6], key)}` };
  }
  m = new RegExp(`^DELETE FROM ${name3} WHERE \`([^\`]+)\` = :([A-Za-z0-9_]+)$`, "is").exec(s);
  if (m) {
    const { schema, table: t } = table(m[1], m[2], m[3]);
    const key = column(t, m[4]);
    return { kind: "dml" as const, columns: [], params, sql: `DELETE FROM ${q(pgSchema(schema.name))}.${q(t.name)} WHERE ${q(key.name)} = ${param(m[5], key)}` };
  }
  throw new UcError(400, "UNSUPPORTED_STATEMENT", "The local catalog runs single-table SELECT, INSERT, UPDATE and DELETE statements only.");
}
