/* The studio's database: PostgreSQL 18, embedded (PGlite, on disk under
   apps/studio/.data/pg) by default, or any Postgres via DATABASE_URL (for
   example the docker-compose postgres:18 service). Each app gets its own schema,
   deployed from the SQL UMF compiles for it, and seeded from its samples. */

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexDefinition, sampleRows } from "@ux-builder/app-definition";
import type { AppDefinition } from "@ux-builder/app-runtime/contract";
import { compileDeployment, type Deployment } from "./umf.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.STUDIO_DATA_DIR ?? join(here, "..", ".data");

interface Executor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  describe: string;
}

async function pglite(): Promise<Executor> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.STUDIO_PG_MEMORY ? undefined : join(DATA_DIR, "pg");
  if (dir) mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  const wrap = (q: any): Executor => ({
    async query(sql, params = []) { return (await q.query(sql, params)).rows; },
    async exec(sql) { await q.exec(sql); },
    async transaction(fn) { return db.transaction((tx: any) => fn(wrap(tx))); },
    async close() { await db.close(); },
    describe: `PGlite (embedded PostgreSQL) at ${dir ?? "memory"}`,
  });
  return wrap(db);
}

async function postgres(url: string): Promise<Executor> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const wrap = (q: any): Executor => ({
    async query(sql, params = []) { return (await q.query(sql, params)).rows; },
    async exec(sql) { await q.query(sql); },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
    describe: `PostgreSQL at ${url.replace(/:[^:@/]*@/, ":***@")}`,
  });
  return wrap(pool);
}

let executor: Promise<Executor> | null = null;
export const database = () => (executor ??= process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : pglite());

const ident = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
export const schemaFor = (appId: string) => `app_${appId.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 40);

/* Deploy (or redeploy) an app's schema from UMF's SQL and seed its samples. */
export async function deployApp(doc: AppDefinition): Promise<Deployment> {
  const db = await database();
  const schema = schemaFor(doc.id);
  const deployment = await compileDeployment(doc, schema);
  const idx = indexDefinition(doc);
  await db.transaction(async (tx) => {
    await tx.exec(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    for (const role of deployment.roles) {
      await tx.exec(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role.replace(/'/g, "''")}') THEN CREATE ROLE ${ident(role)} NOLOGIN; END IF; END $$`);
    }
    await tx.exec(`CREATE SCHEMA ${ident(schema)}`);
    for (const step of deployment.steps) await tx.exec(step.sql.trim().replace(/;?\s*$/, ";"));
    const store = pgStore(idx, schema, tx);
    for (const { record, rows } of sampleRows(idx)) for (const row of rows) await store.insert(record, row);
  });
  return deployment;
}

const toJs = (scalarType: string, v: unknown) => {
  if (v == null) return null;
  switch (scalarType) {
    case "decimal": case "float": case "integer": return Number(v);
    case "date": return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    case "timestamp": return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
    case "boolean": return v === true || v === "t" || v === "true";
    default: return v;
  }
};

/* The engine's store over an app's tables. */
export function pgStore(idx: ReturnType<typeof indexDefinition>, schema: string, q?: Executor) {
  const table = (recordId: string) => {
    const rec = idx.recordById(recordId);
    if (!rec) throw new Error(`Unknown record ${recordId}`);
    return { rec, name: `${ident(schema)}.${ident(rec.id)}` };
  };
  const ex = async () => q ?? (await database());
  const store = {
    async all(recordId: string) {
      const { rec, name } = table(recordId);
      const rows = await (await ex()).query(`SELECT * FROM ${name} ORDER BY ${ident(rec.keyName)}`);
      return rows.map((r) => Object.fromEntries(rec.fields.map((f: any) => [f.name, toJs(f.scalarType, (r as any)[f.name])])));
    },
    async insert(recordId: string, row: Record<string, unknown>) {
      const { rec, name } = table(recordId);
      const cols: string[] = rec.fields.map((f: any) => f.name);
      await (await ex()).query(`INSERT INTO ${name} (${cols.map(ident).join(", ")}) VALUES (${cols.map((_: string, i: number) => `$${i + 1}`).join(", ")})`, cols.map((c: string) => row[c] ?? null));
    },
    async update(recordId: string, key: string, values: Record<string, unknown>) {
      const { rec, name } = table(recordId);
      const cols = Object.keys(values).filter((c) => rec.fields.some((f: any) => f.name === c));
      if (!cols.length) return;
      const res = await (await ex()).query(`UPDATE ${name} SET ${cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ")} WHERE ${ident(rec.keyName)} = $${cols.length + 1} RETURNING 1`, [...cols.map((c) => values[c] ?? null), key]);
      if (!res.length) throw Object.assign(new Error(`${rec.title} ${key} does not exist`), { code: "NOT_FOUND" });
    },
    async remove(recordId: string, key: string) {
      const { rec, name } = table(recordId);
      await (await ex()).query(`DELETE FROM ${name} WHERE ${ident(rec.keyName)} = $1`, [key]);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (q) return fn();
      return (await database()).transaction(async (tx) => {
        const inner = pgStore(idx, schema, tx);
        return withStore(inner, fn);
      });
    },
  };
  return store;
}

/* runAction calls the store's methods inside transaction(fn) through the same
   store object; while fn runs, route them to that transaction's executor. */
const txStores = new AsyncLocalStorage<ReturnType<typeof pgStore>>();
function withStore<T>(inner: ReturnType<typeof pgStore>, fn: () => Promise<T>) {
  return txStores.run(inner, fn);
}

/* A store whose calls go to the transaction in progress, if any. */
export function appStore(doc: AppDefinition) {
  const idx = indexDefinition(doc);
  const base = pgStore(idx, schemaFor(doc.id));
  const pick = () => txStores.getStore() ?? base;
  return {
    all: (r: string) => pick().all(r),
    insert: (r: string, row: Record<string, unknown>) => pick().insert(r, row),
    update: (r: string, k: string, v: Record<string, unknown>) => pick().update(r, k, v),
    remove: (r: string, k: string) => pick().remove(r, k),
    transaction: <T>(fn: () => Promise<T>) => base.transaction(fn),
  };
}

export async function schemaExists(appId: string) {
  const rows = await (await database()).query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [schemaFor(appId)]);
  return rows.length > 0;
}

export async function describeDatabase() {
  return (await database()).describe;
}
