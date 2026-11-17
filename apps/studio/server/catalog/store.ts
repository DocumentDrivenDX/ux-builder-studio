/* The engine's store for an app whose records may live in the data catalog:
   records with a source (umf.app sources) are read and changed in the
   catalog as the signed-in person; every other record stays in the app's own
   PostgreSQL tables.

   An action runs in the app's own transaction. Its changes to the catalog are
   held until the action has done everything else, then sent; if the catalog
   refuses one, the action fails and the app's own changes are rolled back.
   (The semantic checks keep an action to one catalog table, since the
   catalog can't undo a change to one table when a second refuses.) */

import { indexDefinition } from "@ux-builder/app-definition";
import type { AppDefinition } from "@ux-builder/app-runtime/contract";
import type { User } from "../auth.js";
import { describeTable } from "./service.js";
import { CatalogError, type UnityCatalog } from "./unity.js";

type Row = Record<string, unknown>;
type BaseStore = {
  all(r: string): Promise<Row[]>;
  insert(r: string, row: Row): Promise<void>;
  update(r: string, k: string, v: Row): Promise<void>;
  remove(r: string, k: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};
export type CatalogAccess = { catalog: UnityCatalog; token: string; user: User } | null;
export type SourceReport = { record: string; asset: string; rows: number; limit: number; truncated: boolean };

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

const toJs = (scalarType: string, v: unknown) => {
  if (v == null) return null;
  switch (scalarType) {
    case "decimal": case "float": case "integer": return Number(v);
    case "boolean": return v === true || v === "true";
    case "date": return String(v).slice(0, 10);
    case "timestamp": return new Date(String(v)).toISOString();
    default: return String(v);
  }
};
const toText = (v: unknown) => (v == null || v === "" ? null : typeof v === "boolean" ? (v ? "true" : "false") : String(v));

export function liveStore(doc: AppDefinition, base: BaseStore, access: CatalogAccess) {
  const idx = indexDefinition(doc);
  const reports = new Map<string, SourceReport>();
  let held: Array<() => Promise<void>> | null = null;

  const sourceOf = (recordId: string) => {
    const rec = idx.recordById(recordId);
    const src = rec ? idx.sourceOf(rec.id) : null;
    return rec && src ? { rec, src } : null;
  };
  const need = () => {
    if (!access) throw fail("NO_CATALOG", "This app reads the organisation's data catalog: sign in to use it");
    return access;
  };
  const column = (src: { columns?: Record<string, string> }, field: string) => src.columns?.[field] ?? field;
  const table = async (asset: string) => { const a = need(); return describeTable(a.catalog, a.token, a.user, asset); };
  const typed = async (asset: string, src: { columns?: Record<string, string> }, values: Row) => {
    const t = await table(asset);
    const out: Record<string, { value: string | null; type: string }> = {};
    for (const [field, v] of Object.entries(values)) {
      const name = column(src, field);
      const col = t.columns.find((c) => c.name === name);
      if (!col) throw fail("CATALOG_COLUMN", `${asset} has no column ${name}`);
      out[name] = { value: toText(v), type: col.type };
    }
    return out;
  };
  const refused = (e: unknown, title: string, asset: string): never => {
    if (e instanceof CatalogError && (e.code === "PERMISSION_DENIED" || e.status === 403)) throw fail("FORBIDDEN", `You may not change ${title.toLowerCase()} in the data catalog (${asset})`);
    if (e instanceof CatalogError) throw fail(e.code, e.message);
    throw e;
  };
  const write = async (op: () => Promise<void>) => { if (held) held.push(op); else await op(); };

  const store = {
    reports,
    async all(recordId: string) {
      const s = sourceOf(recordId);
      if (!s) return base.all(recordId);
      const a = need();
      const limit = s.src.limit ?? 5000;
      const t = await table(s.src.asset);
      const fields = s.rec.fields.filter((f: any) => t.columns.some((c) => c.name === column(s.src, f.name)));
      const rows = await a.catalog.select(a.token, s.src.asset, fields.map((f: any) => column(s.src, f.name)), limit + 1).catch((e) => refused(e, s.rec.title, s.src.asset));
      reports.set(s.rec.id, { record: s.rec.id, asset: s.src.asset, rows: Math.min(rows.length, limit), limit, truncated: rows.length > limit });
      return rows.slice(0, limit).map((r) => Object.fromEntries(s.rec.fields.map((f: any) => [f.name, toJs(f.scalarType, r[column(s.src, f.name)])])));
    },
    async insert(recordId: string, row: Row) {
      const s = sourceOf(recordId);
      if (!s) return base.insert(recordId, row);
      if (s.src.access !== "change") throw fail("FORBIDDEN", `This app only reads ${s.src.asset}`);
      const values = await typed(s.src.asset, s.src, Object.fromEntries(Object.entries(row).filter(([, v]) => v != null)));
      await write(async () => { const a = need(); await a.catalog.insert(a.token, s.src.asset, values).catch((e) => refused(e, s.rec.title, s.src.asset)); });
    },
    async update(recordId: string, key: string, values: Row) {
      const s = sourceOf(recordId);
      if (!s) return base.update(recordId, key, values);
      if (s.src.access !== "change") throw fail("FORBIDDEN", `This app only reads ${s.src.asset}`);
      const v = await typed(s.src.asset, s.src, values);
      const keyCol = (await typed(s.src.asset, s.src, { [s.rec.keyName]: key }))[column(s.src, s.rec.keyName)];
      await write(async () => {
        const a = need();
        const n = await a.catalog.update(a.token, s.src.asset, { column: column(s.src, s.rec.keyName), ...keyCol, value: key }, v).catch((e) => refused(e, s.rec.title, s.src.asset));
        if (!n) throw fail("NOT_FOUND", `That ${s.rec.title.toLowerCase()} is not available to you in the data catalog`);
      });
    },
    async remove(recordId: string, key: string) {
      const s = sourceOf(recordId);
      if (!s) return base.remove(recordId, key);
      if (s.src.access !== "change") throw fail("FORBIDDEN", `This app only reads ${s.src.asset}`);
      const keyCol = (await typed(s.src.asset, s.src, { [s.rec.keyName]: key }))[column(s.src, s.rec.keyName)];
      await write(async () => {
        const a = need();
        const n = await a.catalog.remove(a.token, s.src.asset, { column: column(s.src, s.rec.keyName), ...keyCol, value: key }).catch((e) => refused(e, s.rec.title, s.src.asset));
        if (!n) throw fail("NOT_FOUND", `That ${s.rec.title.toLowerCase()} is not available to you in the data catalog`);
      });
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return base.transaction(async () => {
        held = [];
        try {
          const out = await fn();
          // Only an action that succeeded sends its catalog changes.
          if (!(out && typeof out === "object" && (out as { ok?: boolean }).ok === false)) for (const op of held) await op();
          return out;
        } finally {
          held = null;
        }
      });
    },
  };
  return store;
}
