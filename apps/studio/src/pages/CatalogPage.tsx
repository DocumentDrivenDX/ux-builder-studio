/* The organisation's data catalog, as the signed-in person sees it: only the
   schemas and tables they may read, what each holds, what they may do with
   it (and through which group), and how the catalog narrows it for them
   (row filters, masked columns). From a table, they can start an app. */
import { useEffect, useState } from "react";
import { Card, DataTable, Notice, Skeleton, StatusPill } from "@ux-builder/ui";
import { DescriptionList, Page, PageHeader, Stack } from "@ux-builder/ui/patterns";
import { Button } from "../agent/generated/bound/ux-builder-ui";
import { api, type CatalogInfo, type CatalogTable, type CatalogTree, type TableAccess } from "../api";
import { navigate } from "../router";
import { useSession } from "../session";

export const accessLabel = (a: TableAccess) => (a.change ? "Read and change" : "Read only");
export const AccessPill = ({ access }: { access: TableAccess }) => <StatusPill state={access.change ? "live" : "neutral"}>{accessLabel(access)}</StatusPill>;

export function CatalogPage() {
  const { me } = useSession();
  const [info, setInfo] = useState<CatalogInfo | null>(null);
  const [tree, setTree] = useState<CatalogTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("table"));
  const [table, setTable] = useState<CatalogTable | null>(null);
  const [rows, setRows] = useState<{ columns: string[]; rows: Array<Record<string, string | null>> } | null>(null);

  useEffect(() => {
    api.catalog().then(setInfo).catch(() => {});
    api.catalogTree().then((r) => {
      setTree(r.tree);
      setSelected((s) => s ?? r.tree[0]?.schemas.find((x) => x.tables.length)?.tables[0]?.fullName ?? null);
    }, (e) => setError(e?.body?.message ?? String(e?.message ?? e)));
  }, []);
  useEffect(() => {
    if (!selected) return;
    setTable(null);
    setRows(null);
    window.history.replaceState(null, "", `/catalog?table=${encodeURIComponent(selected)}`);
    api.catalogTable(selected).then(setTable, (e) => setError(e?.body?.message ?? String(e?.message ?? e)));
    api.catalogRows(selected, 20).then(setRows, () => setRows({ columns: [], rows: [] }));
  }, [selected]);

  if (info && !info.available) {
    return <Page><Stack gap={4}><PageHeader title="Data catalog" /><Notice tone="info" title="No data catalog is connected">Apps here keep their own data. Connect the organisation's Unity Catalog to build apps on its data.</Notice></Stack></Page>;
  }
  const masked = table?.columns.filter((c) => c.mask) ?? [];
  return (
    <Page>
      <Stack gap={5}>
        <PageHeader title="Data catalog" description={`${info?.label ?? "The organisation's data catalog"}. You see only what you may read, as ${me?.name ?? "yourself"}; apps you make see the same, never more.`} />
        {error ? <Notice tone="error" title={error} role="alert" /> : null}
        <div className="catalog">
          <nav className="catalog__tree" aria-label="Catalog">
            {tree === null ? <Skeleton lines={6} /> : tree.map((c) => (
              <div key={c.name} className="catalog__catalog">
                <p className="catalog__catalog-name">{c.name}</p>
                {c.schemas.map((s) => (
                  <section key={s.fullName} className="catalog__schema" aria-label={`Schema ${s.name}`}>
                    <h2 className="catalog__schema-name" title={s.comment ?? undefined}>{s.name}</h2>
                    {s.tables.length ? (
                      <ul className="catalog__tables">
                        {s.tables.map((t) => (
                          <li key={t.fullName}>
                            <button type="button" className="catalog__table" aria-current={selected === t.fullName ? "true" : undefined} onClick={() => setSelected(t.fullName)} data-non-agent="the App Expert reads the catalog through the catalog room's observation">
                              <span className="catalog__table-name">{t.name}</span>
                              <span className="catalog__table-access">{t.access.change ? "Read and change" : "Read only"}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="studio-meta">Nothing here you may read.</p>}
                  </section>
                ))}
              </div>
            ))}
          </nav>
          <div className="catalog__detail">
            {!table ? (selected ? <Skeleton lines={8} /> : <p className="studio-meta">Choose a table.</p>) : (
              <Stack gap={4}>
                <Card title={table.name} actions={me?.builder ? (
                  <Button onClick={() => navigate(`/?kind=${table.access.change ? "data-management" : "reporting"}&tables=${encodeURIComponent(table.fullName)}`)} agent={{ id: "catalog.new-app", description: "Start a new app on the table shown, as a reporting app (read only) or a data management app (when the person may change it)" }}>Make an app with it</Button>
                ) : undefined}>
                  <Stack gap={3}>
                    {table.comment ? <p>{table.comment}</p> : null}
                    <DescriptionList items={[
                      { label: "Full name", value: table.fullName },
                      { label: "You may", value: <span className="catalog__you-may"><AccessPill access={table.access} />{table.access.change && table.access.changeVia ? ` through ${table.access.changeVia}` : table.access.readVia ? ` through ${table.access.readVia}` : ""}</span> },
                      { label: "Owner", value: table.owner ?? "—" },
                      { label: "Key", value: table.primaryKey ?? "—" },
                      ...(table.foreignKeys.length ? [{ label: "Links to", value: table.foreignKeys.map((f) => `${f.column} → ${f.parent}`).join("; ") }] : []),
                    ]} />
                    {table.rowFilter ? <Notice tone="info" title="Rows are filtered for you">{table.rowFilter.comment ?? `The catalog applies ${table.rowFilter.function}.`}</Notice> : null}
                    {masked.length ? <Notice tone="info" title={`${masked.length === 1 ? "A column is" : `${masked.length} columns are`} masked for some people`}>{masked.map((c) => `${c.name}: ${c.mask?.comment ?? c.mask?.function}`).join(". ")}.</Notice> : null}
                  </Stack>
                </Card>
                <DataTable caption={`${table.name}: columns`} pageSize={50}
                  columns={[{ key: "name", label: "Column" }, { key: "type", label: "Type" }, { key: "comment", label: "Meaning" }, { key: "notes", label: "Notes" }]}
                  rows={table.columns.map((c) => ({ id: c.name, name: c.name, type: c.type.toLowerCase(), comment: c.comment ?? "—", notes: [c.name === table.primaryKey ? "key" : "", c.nullable ? "" : "required", c.values ? `one of ${c.values.join(", ")}` : "", c.mask ? "masked for some" : ""].filter(Boolean).join("; ") || "—" }))} />
                {rows === null ? <Skeleton lines={4} /> : rows.columns.length ? (
                  <DataTable caption={`${table.name}: the first ${rows.rows.length} rows, as you see them`} pageSize={10}
                    columns={rows.columns.map((c) => ({ key: c, label: c }))}
                    rows={rows.rows.map((r, i) => ({ id: String(r[table.primaryKey ?? rows.columns[0]] ?? i), ...Object.fromEntries(rows.columns.map((c) => [c, r[c] ?? "—"])) }))} />
                ) : <p className="studio-meta">No rows to show you.</p>}
              </Stack>
            )}
          </div>
        </div>
      </Stack>
    </Page>
  );
}
