/* A collection region: the rows of a record as CollectionList, with search,
   sort, paging, row actions, selection with bulk actions, and its empty
   state. The query lives in React state, never in the URL: the renderer is
   embedded in a host page. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StatePanel, CollectionList } from "@ux-builder/ui/patterns";
import { useApp } from "../context";
import type { Row } from "../contract";
import type { Region, ValueRef } from "../definition";
import { ActionButton, useActionItems } from "../actions";
import { Cell } from "../cells";
import { mayRun } from "../engine";
import {
  compareKeys,
  displayField,
  rawValue,
  resolveValue,
  rolesAllow,
  rowsOf,
  ruleHolds,
  sortKey,
  text,
  valueFormat,
  valueIsNumeric,
  valueLabel,
  type Runtime,
  type Scope,
} from "../runtime";

const PAGE_SIZE = 20;
const SEARCHABLE = new Set(["text", "email", "multiline", "status"]);

export interface HeaderSlots {
  title: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
}

type Sort = { key: string; dir: "ascending" | "descending" };

export function CollectionRegion({ region, scope, screenKey, header }: { region: Region; scope: Scope; screenKey?: string; header?: HeaderSlots }) {
  const { rt, loading } = useApp();
  const items = useActionItems();
  const rec = region.record ? rt.idx.record(region.record) : undefined;
  const columns = region.columns ?? [];
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  // Rows that pass the region's filter, in the region's default order.
  const base = useMemo(() => {
    const rows = rowsOf(rt, rec?.id).filter((r) => ruleHolds(region.filter, { ...scope, row: r }));
    return sortRows(rt, rows, scope, (region.sort ?? []).map((s) => ({ vr: s.by, dir: s.direction ?? "ascending" })));
  }, [rt, rec?.id, region.filter, region.sort, scope]);

  const shown = useMemo(() => {
    let rows = base;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => haystack(rt, region, r, scope).includes(q));
    if (sort) {
      const i = Number(sort.key.slice(1));
      if (columns[i]) rows = sortRows(rt, rows, scope, [{ vr: columns[i], dir: sort.dir }]);
    }
    return rows;
  }, [base, search, sort, rt, region, scope, columns]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // Keep the selection to rows that still exist (an action may have removed some).
  const keys = useMemo(() => new Set(base.map((r) => r.$key)), [base]);
  const liveSelected = useMemo(() => selected.filter((k) => keys.has(k)), [selected, keys]);

  const mayAct = (actions: Region["rowActions"]) => (actions ?? []).some((p) => mayRun(rt.idx, p.action, rt.identity) && rolesAllow(p.roles, rt.identity));
  const hasRowActions = mayAct(region.rowActions);
  const selectable = mayAct(region.bulkActions);
  const nameField = rec ? displayField(rec) : undefined;
  const named = nameField && ["name", "title", "label"].includes(nameField.name);

  // Compact cards and medium tables show the priority columns. Unless the definition marks some,
  // those are the first two columns and any status, so a card never hides where a row stands.
  const marked = columns.some((c) => c.priority);
  const priority = (c: ValueRef, i: number) => (marked ? !!c.priority : i < 2 || valueFormat(rt, c) === "status");
  const listColumns = columns.map((c, i) => ({
    key: `c${i}`,
    label: valueLabel(rt, c),
    numeric: valueIsNumeric(rt, c),
    priority: priority(c, i),
    sortable: true,
    render: (r: Row) => <Cell rt={rt} vr={c} row={r} scope={scope} link={i === 0 ? region.rowLink : undefined} />,
  }));

  const selectionScope: Scope = { ...scope, selection: liveSelected };
  const bulk = selectable
    ? (region.bulkActions ?? []).map((p, i) => (
      <ActionButton key={`${p.action}-${i}`} placement={p} variant={p.emphasis === "primary" ? "primary" : "secondary"}
        ctx={{ scope: selectionScope, selection: liveSelected, screenKey, onDone: () => setSelected([]) }} />
    ))
    : undefined;

  const empty = region.empty
    ? <StatePanel kind="empty" title={text(region.empty.title, scope)}>{region.empty.message ? <p>{text(region.empty.message, scope)}</p> : undefined}</StatePanel>
    : undefined;
  const status = loading ? "loading" : shown.length ? "ready" : "empty";
  const searchable = base.length > 0 || search !== "";
  const title = header?.title ?? (region.title ? text(region.title, scope) : rec?.title);

  return (
    <CollectionList
      title={title}
      breadcrumbs={header?.breadcrumbs}
      actions={header?.actions}
      secondaryActions={header?.secondaryActions}
      columns={listColumns}
      rows={pageRows}
      rowKey="$key"
      rowLabel={(r: Row) => (named && nameField && r[nameField.name] != null ? String(r[nameField.name]) : columns[0] ? resolveValue(rt, columns[0], r, scope).text : r.$key)}
      caption={typeof title === "string" ? title : rec?.title}
      status={status}
      empty={empty}
      search={searchable ? search : undefined}
      onSearchChange={searchable ? (v: string) => { setSearch(v); setPage(1); } : undefined}
      searchLabel={rec ? `Search ${rec.title.toLowerCase()}` : "Search"}
      onClearFilters={() => { setSearch(""); setPage(1); }}
      selectable={selectable}
      selected={liveSelected}
      onSelectedChange={setSelected}
      bulkActions={bulk}
      rowActions={hasRowActions ? (r: Row) => items(region.rowActions, { scope: { ...scope, row: r }, row: r, screenKey }) : undefined}
      sort={sort ?? undefined}
      onSortChange={(s: Sort) => { setSort(s); setPage(1); }}
      page={current}
      pageSize={PAGE_SIZE}
      total={shown.length}
      onPageChange={setPage}
    />
  );
}

/** The text a row is searched by: the region's search fields, else every textual column as shown. */
function haystack(rt: Runtime, region: Region, row: Row, scope: Scope): string {
  if (region.search?.length) {
    return region.search.map((ref) => { const f = rt.idx.field(ref); return f ? String(row[f.name] ?? "") : ""; }).join(" ").toLowerCase();
  }
  return (region.columns ?? [])
    .filter((c) => SEARCHABLE.has(valueFormat(rt, c)))
    .map((c) => resolveValue(rt, c, row, scope).text)
    .join(" ")
    .toLowerCase();
}

export function sortRows(rt: Runtime, rows: Row[], scope: Scope, by: Array<{ vr: ValueRef; dir: "ascending" | "descending" }>): Row[] {
  if (!by.length) return rows;
  const keyed = rows.map((r) => ({ r, k: by.map((b) => sortKey(rawValue(rt, b.vr, r, scope))) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < by.length; i++) {
      const c = compareKeys(a.k[i], b.k[i]);
      if (c) return by[i].dir === "descending" && a.k[i] !== null && b.k[i] !== null ? -c : c;
    }
    return 0;
  });
  return keyed.map((x) => x.r);
}
