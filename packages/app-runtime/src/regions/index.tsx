/* A screen's regions, by kind. Each region is a section with its own heading
   (level 2) unless it carries the screen's heading itself (a collection or a
   form that opens the screen). */
import { useId, type ReactNode } from "react";
import { Notice, Skeleton } from "@ux-builder/ui";
import { Cluster, DescriptionList, Grid, StatTile } from "@ux-builder/ui/patterns";
import { useApp } from "../context";
import type { Location, Row } from "../contract";
import type { DocumentSection, Region, ValueRef } from "../definition";
import { ActionButton } from "../actions";
import { renderResolved } from "../cells";
import { formatValue } from "../format";
import { evalRule, relatedRows, resolveValue, text, valueFormat, valueLabel, type Runtime, type Scope } from "../runtime";
import { CollectionRegion, type HeaderSlots } from "./CollectionRegion";
import { EmptyRows, RowsTable, Totals } from "./RowsTable";
import { FormRegion } from "./FormRegion";
import { ScheduleRegion } from "./ScheduleRegion";

export { CollectionRegion, FormRegion, ScheduleRegion };
export type { HeaderSlots };

export interface RegionProps {
  region: Region;
  /** The screen's scope: record (the screen's row), params, user, … */
  scope: Scope;
  /** The screen's parameter (a row key), if it has one. */
  screenKey?: string;
  /** The screen's row, for record, related and document regions. */
  row?: Row;
  /** When this region carries the screen's heading. */
  header?: HeaderSlots;
  /** When a form region is the screen's page. */
  page?: { title: string; description?: string; breadcrumbs?: ReactNode };
  back?: Location;
}

export function RegionView(props: RegionProps) {
  const { region, scope, screenKey, row, header, page, back } = props;
  const { rt, loading } = useApp();
  const title = region.title ? text(region.title, scope) : "";
  const description = region.description ? text(region.description, scope) : "";

  if (region.kind === "collection") return <CollectionRegion region={region} scope={scope} screenKey={screenKey} header={header} />;
  if (region.kind === "form" && page) return <FormRegion region={region} scope={scope} screenKey={screenKey} page={page} back={back} />;

  let body: ReactNode;
  if (loading) {
    body = <div aria-busy="true"><Skeleton lines={3} /></div>;
  } else {
    switch (region.kind) {
      case "record":
        body = row ? <FieldList rt={rt} fields={region.fields ?? []} row={row} scope={scope} /> : null;
        break;
      case "related":
        body = <Related region={region} row={row} scope={scope} screenKey={screenKey} title={title} />;
        break;
      case "form":
        return <FormRegion region={region} scope={scope} screenKey={screenKey} back={back} />;
      case "schedule":
        body = <ScheduleRegion region={region} scope={scope} screenKey={screenKey} title={title} />;
        break;
      case "stats":
        body = <Stats region={region} scope={scope} />;
        break;
      case "notice":
        return (
          <Notice tone={region.tone ?? "info"} title={title || text(region.message, scope)}>
            {title && region.message ? text(region.message, scope) : undefined}
          </Notice>
        );
      case "actions":
        body = (
          <Cluster gap={2}>
            {(region.items ?? []).map((p, i) => (
              <ActionButton key={`${p.action}-${i}`} placement={p} ctx={{ scope, row, screenKey }} variant={p.emphasis === "primary" ? "primary" : p.emphasis === "text" ? "text" : "secondary"} />
            ))}
          </Cluster>
        );
        break;
      case "document":
        return <DocumentView region={region} row={row} scope={scope} screenKey={screenKey} title={title} description={description} />;
      default:
        body = null;
    }
  }
  return <RegionSection title={title} description={description}>{body}</RegionSection>;
}

export function RegionSection({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`app-rt-region${className ? ` ${className}` : ""}`} aria-labelledby={title ? id : undefined}>
      {title && <h2 id={id} className="app-rt-region__title">{title}</h2>}
      {description && <p className="app-rt-region__description">{description}</p>}
      {children}
    </section>
  );
}

/* ---------- record ---------- */

function FieldList({ rt, fields, row, scope }: { rt: Runtime; fields: ValueRef[]; row: Row; scope: Scope }) {
  const items = fields.map((f, i) => {
    const v = resolveValue(rt, f, row, { ...scope, row });
    const empty = v.raw == null || v.raw === "";
    return { key: i, label: valueLabel(rt, f), value: empty ? null : renderResolved(v), wide: f.wide ?? v.format === "multiline" };
  });
  return <DescriptionList items={items} />;
}

/* ---------- related ---------- */

function Related({ region, row, scope, screenKey, title }: { region: Region; row?: Row; scope: Scope; screenKey?: string; title: string }) {
  const { rt } = useApp();
  const rows = row && region.relationship ? relatedRows(rt, row, region.relationship) : [];
  const empty = <EmptyRows title={region.empty ? text(region.empty.title, scope) : "Nothing here yet"} message={region.empty?.message ? text(region.empty.message, scope) : undefined} />;
  return (
    <>
      <RowsTable rows={rows} columns={region.columns ?? []} rowActions={region.rowActions} rowLink={region.rowLink} caption={title || "Related"} scope={scope} screenKey={screenKey} empty={empty} />
      {rows.length > 0 && region.totals?.length ? <Totals totals={region.totals} rows={rows} scope={scope} /> : null}
    </>
  );
}

/* ---------- stats ---------- */

function Stats({ region, scope }: { region: Region; scope: Scope }) {
  const { rt } = useApp();
  const tiles = region.tiles ?? [];
  const n = Math.max(1, Math.min(4, tiles.length));
  return (
    <Grid columns={{ compact: 1, medium: Math.min(2, n), expanded: Math.min(3, n), large: n }} gap={4}>
      {tiles.map((t, i) => (
        <StatTile key={i} label={t.label} value={formatValue(evalRule(t.value, scope), t.format ?? "number", rt.snapshot.now)} />
      ))}
    </Grid>
  );
}

/* ---------- document ---------- */

function DocumentView({ region, row, scope, screenKey, title, description }: { region: Region; row?: Row; scope: Scope; screenKey?: string; title: string; description: string }) {
  const { rt, loading } = useApp();
  const id = useId();
  return (
    <article className="app-rt-document" aria-labelledby={title ? id : undefined}>
      {title && <h2 id={id} className="app-rt-document__title">{title}</h2>}
      {description && <p className="app-rt-region__description">{description}</p>}
      {loading ? <Skeleton lines={6} /> : (region.sections ?? []).map((sec) => (
        <DocumentPart key={sec.id} rt={rt} section={sec} row={row} scope={scope} screenKey={screenKey} />
      ))}
    </article>
  );
}

function DocumentPart({ rt, section, row, scope, screenKey }: { rt: Runtime; section: DocumentSection; row?: Row; scope: Scope; screenKey?: string }) {
  const id = useId();
  const title = section.title ? text(section.title, scope) : "";
  const rows = row && section.relationship ? relatedRows(rt, row, section.relationship) : null;
  return (
    <section className="app-rt-document__section" aria-labelledby={title ? id : undefined}>
      {title && <h3 id={id} className="app-rt-document__heading">{title}</h3>}
      {row && section.fields?.length ? <FieldList rt={rt} fields={section.fields} row={row} scope={scope} /> : null}
      {rows && (
        <RowsTable rows={rows} columns={section.columns ?? []} rowActions={section.rowActions} caption={title || "Lines"} scope={scope} screenKey={screenKey}
          empty={<p className="app-rt-document__empty">{section.empty ? text(section.empty, scope) : "None."}</p>} />
      )}
      {section.totals?.length ? <Totals totals={section.totals} scope={scope} of={row ?? null} /> : null}
    </section>
  );
}

/** The format a total is shown in (for callers outside this module). */
export const totalFormat = (rt: Runtime, t: ValueRef) => valueFormat(rt, t);
