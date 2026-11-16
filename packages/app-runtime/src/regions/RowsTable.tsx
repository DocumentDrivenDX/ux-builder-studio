/* Rows shown inside a screen (related rows, a document's lines): a DataTable
   with the region's columns, a row-actions menu per row, an empty state and
   totals. DataTable sorts by row[column.key], so each row carries its
   columns' sort keys under "$c<i>". */
import type { ReactNode } from "react";
import { DataTable, MenuButton } from "@ux-builder/ui";
import { StatePanel } from "@ux-builder/ui/patterns";
import { mayRun } from "../engine";
import { useApp } from "../context";
import type { Row } from "../contract";
import type { Navigate, Placement, ValueRef } from "../definition";
import { useActionItems } from "../actions";
import { Cell, renderResolved } from "../cells";
import { formatValue, toNumber } from "../format";
import { rawValue, resolveValue, rolesAllow, sortKey, valueFormat, valueIsNumeric, valueLabel, type Runtime, type Scope } from "../runtime";

export function RowsTable({ rows, columns, rowActions, rowLink, caption, scope, screenKey, empty }: {
  rows: Row[];
  columns: ValueRef[];
  rowActions?: Placement[];
  rowLink?: Navigate;
  caption: string;
  scope: Scope;
  screenKey?: string;
  empty: ReactNode;
}) {
  const { rt } = useApp();
  const items = useActionItems();
  if (!rows.length) return <>{empty}</>;
  const offered = (rowActions ?? []).filter((p) => mayRun(rt.idx, p.action, rt.identity) && rolesAllow(p.roles, rt.identity));
  const keyed = rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    columns.forEach((c, i) => { out[`$c${i}`] = sortKey(rawValue(rt, c, r, { ...scope, row: r })) ?? ""; });
    return out as Row;
  });
  const cols: Array<{ key: string; label: ReactNode; numeric?: boolean; sortable?: boolean; render(r: Row): ReactNode }> = columns.map((c, i) => ({
    key: `$c${i}`,
    label: valueLabel(rt, c),
    numeric: valueIsNumeric(rt, c),
    sortable: true,
    render: (r: Row) => <Cell rt={rt} vr={c} row={r} scope={{ ...scope, row: r }} link={i === 0 ? rowLink : undefined} />,
  }));
  if (offered.length) {
    cols.push({
      key: "$actions",
      label: <span className="piq-visually-hidden">Actions</span>,
      render: (r: Row) => {
        const menu = items(offered, { scope: { ...scope, row: r }, row: r, screenKey });
        const name = columns[0] ? resolveValue(rt, columns[0], r, { ...scope, row: r }).text : r.$key;
        return menu.length ? <MenuButton icon="more" variant="text" size="sm" align="end" buttonLabel={`Actions for ${name}`} items={menu} /> : null;
      },
    });
  }
  return <DataTable caption={caption} columns={cols} rows={keyed} rowKey="$key" pageSize={25} />;
}

/** Totals for a set of rows: a field or derived value of the rows is summed; an expression is evaluated once, in the screen's scope. */
export function Totals({ totals, rows, scope, of }: { totals: ValueRef[]; rows?: Row[]; scope: Scope; of?: Row | null }) {
  const { rt } = useApp();
  if (!totals.length) return null;
  return (
    <dl className="app-rt-totals">
      {totals.map((t, i) => (
        <div key={i} className="app-rt-totals__item">
          <dt className="app-rt-totals__label">{valueLabel(rt, t) || "Total"}</dt>
          <dd className="app-rt-totals__value">{totalOf(rt, t, rows, scope, of)}</dd>
        </div>
      ))}
    </dl>
  );
}

function totalOf(rt: Runtime, t: ValueRef, rows: Row[] | undefined, scope: Scope, of?: Row | null): ReactNode {
  if (rows && (t.field || t.derived)) {
    const sum = rows.reduce((s, r) => s + (toNumber(rawValue(rt, t, r, scope)) ?? 0), 0);
    return formatValue(sum, valueFormat(rt, t), rt.snapshot.now);
  }
  return renderResolved(resolveValue(rt, t, of ?? scope.record ?? null, scope));
}

export function EmptyRows({ title, message }: { title: string; message?: string }) {
  return <StatePanel kind="empty" title={title}>{message ? <p>{message}</p> : undefined}</StatePanel>;
}
