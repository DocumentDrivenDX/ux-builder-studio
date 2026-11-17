/* A client for a Unity Catalog: the REST API for what is in the catalog and
   who may do what with it, and the SQL Statement Execution API for the rows.
   It talks to a Databricks workspace, or to the studio's local catalog
   (server/org/catalog-server.ts), which answers the same calls in the same
   shapes. Every call carries the signed-in person's own token, so the
   catalog answers as that person: its grants, row filters and column masks
   decide what they see and may change. The studio never holds a token that
   sees more than the person does. */

export class CatalogError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type Column = { name: string; type: string; typeName: string; comment: string | null; nullable: boolean; mask: { function: string; comment: string | null } | null; values: string[] | null };
export type TableInfo = {
  fullName: string;
  catalog: string;
  schema: string;
  name: string;
  comment: string | null;
  owner: string | null;
  columns: Column[];
  primaryKey: string | null;
  foreignKeys: Array<{ column: string; parent: string; parentColumn: string }>;
  rowFilter: { function: string; columns: string[]; comment: string | null } | null;
};
export type Access = { read: boolean; change: boolean; readVia: string | null; changeVia: string | null };

export type CatalogConfig = { host: string; warehouseId: string; label: string; local: boolean };

const ident = (s: string) => `\`${String(s).replace(/`/g, "``")}\``;
const full = (fullName: string) => fullName.split(".").map(ident).join(".");

export class UnityCatalog {
  constructor(public config: CatalogConfig) {}

  private async api(token: string, path: string, init: RequestInit = {}) {
    const res = await fetch(`${this.config.host}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } }).catch((e) => {
      throw new CatalogError(503, "CATALOG_UNREACHABLE", `The data catalog at ${this.config.host} did not answer (${e.message})`);
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new CatalogError(res.status, body.error_code ?? "CATALOG_ERROR", body.message ?? `The data catalog answered ${res.status}`);
    return body;
  }

  async catalogs(token: string): Promise<Array<{ name: string; comment: string | null }>> {
    const b = await this.api(token, `/api/2.1/unity-catalog/catalogs`);
    return (b.catalogs ?? []).map((c: any) => ({ name: c.name, comment: c.comment ?? null }));
  }
  async schemas(token: string, catalog: string): Promise<Array<{ name: string; fullName: string; comment: string | null }>> {
    const b = await this.api(token, `/api/2.1/unity-catalog/schemas?catalog_name=${encodeURIComponent(catalog)}`);
    return (b.schemas ?? []).map((s: any) => ({ name: s.name, fullName: s.full_name, comment: s.comment ?? null }));
  }
  async tables(token: string, catalog: string, schema: string): Promise<TableInfo[]> {
    const b = await this.api(token, `/api/2.1/unity-catalog/tables?catalog_name=${encodeURIComponent(catalog)}&schema_name=${encodeURIComponent(schema)}`);
    return (b.tables ?? []).map(tableInfo);
  }
  async table(token: string, fullName: string): Promise<TableInfo> {
    return tableInfo(await this.api(token, `/api/2.1/unity-catalog/tables/${encodeURIComponent(fullName)}`));
  }
  /* What a row filter or mask does, in the words of its function's comment. */
  async functionComment(token: string, fullName: string): Promise<string | null> {
    return (await this.api(token, `/api/2.1/unity-catalog/functions/${encodeURIComponent(fullName)}`).catch(() => ({}))).comment ?? null;
  }
  /* The person's own effective privileges on a table, and the group each comes through. */
  async access(token: string, fullName: string, principal: string): Promise<Access> {
    const b = await this.api(token, `/api/2.1/unity-catalog/effective-permissions/table/${encodeURIComponent(fullName)}?principal=${encodeURIComponent(principal)}`);
    const privs: Array<{ privilege: string; inherited_from_name?: string | null }> = (b.privilege_assignments ?? []).flatMap((a: any) => a.privileges ?? []);
    const find = (p: string) => privs.find((x) => x.privilege === p || x.privilege === "ALL_PRIVILEGES");
    const sel = find("SELECT"), mod = find("MODIFY");
    return { read: !!sel, change: !!mod, readVia: sel?.inherited_from_name ?? null, changeVia: mod?.inherited_from_name ?? null };
  }

  /* One SQL statement, as the person. Rows come back as strings (JSON_ARRAY), or null. */
  async statement(token: string, statement: string, parameters: Array<{ name: string; value: string | null; type: string }> = []) {
    const b = await this.api(token, `/api/2.0/sql/statements`, {
      method: "POST",
      body: JSON.stringify({ statement, warehouse_id: this.config.warehouseId, parameters, wait_timeout: "30s", on_wait_timeout: "CANCEL", format: "JSON_ARRAY", disposition: "INLINE" }),
    });
    if (b.status?.state !== "SUCCEEDED") {
      const err = b.status?.error ?? {};
      const denied = /PERMISSION_DENIED|INSUFFICIENT_PERMISSIONS/.test(`${err.error_code} ${err.message}`);
      throw new CatalogError(denied ? 403 : 400, denied ? "PERMISSION_DENIED" : err.error_code ?? "STATEMENT_FAILED", err.message ?? `The statement did not run (${b.status?.state})`);
    }
    const columns: string[] = (b.manifest?.schema?.columns ?? []).map((c: any) => c.name);
    return { columns, rows: (b.result?.data_array ?? []) as Array<Array<string | null>> };
  }

  async select(token: string, fullName: string, columns: string[], limit: number) {
    const { rows } = await this.statement(token, `SELECT ${columns.map(ident).join(", ")} FROM ${full(fullName)} LIMIT ${Math.max(1, Math.floor(limit))}`);
    return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  }
  async insert(token: string, fullName: string, values: Record<string, { value: string | null; type: string }>) {
    const cols = Object.keys(values);
    const params = cols.map((c, i) => ({ name: `p${i}`, value: values[c].value, type: values[c].type }));
    return this.affected(await this.statement(token, `INSERT INTO ${full(fullName)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((_, i) => `:p${i}`).join(", ")})`, params));
  }
  async update(token: string, fullName: string, key: { column: string; value: string; type: string }, values: Record<string, { value: string | null; type: string }>) {
    const cols = Object.keys(values);
    const params = [...cols.map((c, i) => ({ name: `p${i}`, value: values[c].value, type: values[c].type })), { name: "key", value: key.value, type: key.type }];
    return this.affected(await this.statement(token, `UPDATE ${full(fullName)} SET ${cols.map((c, i) => `${ident(c)} = :p${i}`).join(", ")} WHERE ${ident(key.column)} = :key`, params));
  }
  async remove(token: string, fullName: string, key: { column: string; value: string; type: string }) {
    return this.affected(await this.statement(token, `DELETE FROM ${full(fullName)} WHERE ${ident(key.column)} = :key`, [{ name: "key", value: key.value, type: key.type }]));
  }
  private affected(r: { rows: Array<Array<string | null>> }) { return Number(r.rows[0]?.[0] ?? 0); }
}

function tableInfo(t: any): TableInfo {
  const constraints: any[] = t.table_constraints ?? [];
  const pk = constraints.find((c) => c.primary_key_constraint)?.primary_key_constraint?.child_columns?.[0] ?? null;
  // Delta keeps CHECK constraints as table properties: "<column> IN ('a', 'b')" names a column's allowed values.
  const allowed = new Map<string, string[]>();
  for (const [k, v] of Object.entries<string>(t.properties ?? {})) {
    if (!k.startsWith("delta.constraints.")) continue;
    const m = /^\s*`?([A-Za-z0-9_]+)`?\s+IN\s*\((.+)\)\s*$/i.exec(v);
    if (m) allowed.set(m[1], [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")));
  }
  return {
    fullName: t.full_name,
    catalog: t.catalog_name,
    schema: t.schema_name,
    name: t.name,
    comment: t.comment ?? null,
    owner: t.owner ?? null,
    columns: (t.columns ?? []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((c: any) => ({
      name: c.name,
      type: String(c.type_text ?? c.type_name ?? "string").toUpperCase(),
      typeName: String(c.type_name ?? "STRING").toUpperCase(),
      comment: c.comment ?? null,
      nullable: c.nullable !== false,
      mask: c.mask ? { function: c.mask.function_name, comment: null } : null,
      values: allowed.get(c.name) ?? null,
    })),
    primaryKey: pk,
    foreignKeys: constraints.filter((c) => c.foreign_key_constraint).map((c) => ({ column: c.foreign_key_constraint.child_columns[0], parent: c.foreign_key_constraint.parent_table, parentColumn: c.foreign_key_constraint.parent_columns[0] })),
    rowFilter: t.row_filter ? { function: t.row_filter.function_name, columns: t.row_filter.input_column_names ?? [], comment: null } : null,
  };
}
