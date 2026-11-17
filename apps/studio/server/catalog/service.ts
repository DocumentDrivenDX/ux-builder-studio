/* The studio's view of the organisation's data catalog: what the signed-in
   person can see in it, what each table holds, and what they may do with it,
   always asked of the catalog as that person (their own token).

   STUDIO_CATALOG chooses the catalog:
   - local (the default with local sign-in): the sample organisation's
     catalog on this machine (server/org/catalog-server.ts);
   - unity: a Databricks workspace (DATABRICKS_HOST, DATABRICKS_WAREHOUSE_ID),
     read with the token from the person's sign-in, so the workspace must be
     the sign-in's issuer (or accept its tokens);
   - none: no catalog. */

import type { Express, Request } from "express";
import { CatalogError, UnityCatalog, type Access, type TableInfo } from "./unity.js";
import { sessionOf, userOf, type User } from "../auth.js";

export type CatalogTable = TableInfo & { access: Access };
export type CatalogTree = Array<{ name: string; comment: string | null; schemas: Array<{ name: string; fullName: string; comment: string | null; tables: Array<{ name: string; fullName: string; comment: string | null; access: Access }> }> }>;

let catalog: UnityCatalog | null = null;
export const setCatalog = (c: UnityCatalog | null) => { catalog = c; };
export const catalogInfo = () => (catalog ? { available: true, label: catalog.config.label, local: catalog.config.local, host: catalog.config.host } : { available: false, label: "No data catalog", local: false, host: null });

/* The catalog and the person's token for it, or why there is none. */
export function catalogFor(req: Request) {
  if (!catalog) throw new CatalogError(503, "NO_CATALOG", "The studio has no data catalog connected");
  const token = sessionOf(req)?.catalogToken;
  if (!token) throw new CatalogError(401, "NO_CATALOG_TOKEN", "Your sign-in carries no access to the data catalog; sign in again");
  return { catalog, token, user: userOf(req) };
}

/* Short-lived answers per person: browsing asks the same things many times. */
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>, ms = 30_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.clear();
  return value;
}
export const forgetCached = (user: User) => { for (const k of cache.keys()) if (k.startsWith(`${user.email}|`)) cache.delete(k); };

export async function describeTable(c: UnityCatalog, token: string, user: User, fullName: string): Promise<CatalogTable> {
  return cached(`${user.email}|table|${fullName}`, async () => {
    const t = await c.table(token, fullName);
    const access = await c.access(token, fullName, user.email).catch(() => ({ read: true, change: false, readVia: null, changeVia: null }));
    if (t.rowFilter) t.rowFilter.comment = await c.functionComment(token, t.rowFilter.function);
    for (const col of t.columns) if (col.mask) col.mask.comment = await c.functionComment(token, col.mask.function);
    return { ...t, access };
  });
}

export async function catalogTree(c: UnityCatalog, token: string, user: User): Promise<CatalogTree> {
  return cached(`${user.email}|tree`, async () => {
    const out: CatalogTree = [];
    for (const cat of await c.catalogs(token)) {
      const schemas = [];
      for (const s of await c.schemas(token, cat.name)) {
        const tables = [];
        for (const t of await c.tables(token, cat.name, s.name)) {
          const access = await c.access(token, t.fullName, user.email).catch(() => ({ read: true, change: false, readVia: null, changeVia: null }));
          if (access.read || access.change) tables.push({ name: t.name, fullName: t.fullName, comment: t.comment, access });
        }
        schemas.push({ ...s, tables });
      }
      out.push({ ...cat, schemas });
    }
    return out;
  });
}

export function mountCatalog(app: Express) {
  const route = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: any, next: any) => fn(req).then((b) => res.json(b)).catch(next);
  app.get("/api/catalog", (_req, res) => { res.json(catalogInfo()); });
  app.get("/api/catalog/tree", route(async (req) => {
    const { catalog: c, token, user } = catalogFor(req);
    return { catalog: catalogInfo(), tree: await catalogTree(c, token, user) };
  }));
  app.get("/api/catalog/tables/:fullName", route(async (req) => {
    const { catalog: c, token, user } = catalogFor(req);
    return describeTable(c, token, user, String(req.params.fullName));
  }));
  /* A first look at a table's rows, as the person sees them. */
  app.get("/api/catalog/tables/:fullName/rows", route(async (req) => {
    const { catalog: c, token, user } = catalogFor(req);
    const t = await describeTable(c, token, user, String(req.params.fullName));
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 200);
    return { columns: t.columns.map((x) => x.name), rows: await c.select(token, t.fullName, t.columns.map((x) => x.name), limit) };
  }));
}
