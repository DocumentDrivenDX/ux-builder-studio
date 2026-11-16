/* A schedule region: a record's rows with start and end timestamps on the
   week time grid. Choosing an event opens its details with the event's
   actions (eventActions, each shown only when its condition holds for that
   row). */
import { useMemo, useState, type ReactNode } from "react";
import { Button, Dialog } from "@ux-builder/ui";
import { DescriptionList, StatePanel } from "@ux-builder/ui/patterns";
import { useApp } from "../context";
import type { Row } from "../contract";
import type { Region } from "../definition";
import { useActions } from "../actions";
import { renderResolved } from "../cells";
import { formatDateTime, formatClock, parseDate, toNumber } from "../format";
import { WeekSchedule, type ScheduleEvent } from "../WeekSchedule";
import { actionLabel, placementVisible, resolveValue, rowsOf, ruleHolds, text, valueLabel, type Scope } from "../runtime";

const SERIES = 8;

export function ScheduleRegion({ region, scope, screenKey, title }: { region: Region; scope: Scope; screenKey?: string; title: string }) {
  const { rt } = useApp();
  const { request } = useActions();
  const rec = region.record ? rt.idx.record(region.record) : undefined;
  const startField = region.start ? rt.idx.field(region.start) : undefined;
  const endField = region.end ? rt.idx.field(region.end) : undefined;
  const [chosen, setChosen] = useState<{ row: Row; event: ScheduleEvent } | null>(null);
  const [open, setOpen] = useState(false);

  const { events, rowsById, colors } = useMemo(() => {
    const rows = rowsOf(rt, rec?.id).filter((r) => ruleHolds(region.filter, { ...scope, row: r }));
    // Colours: the distinct colorBy values, in order, each a series token.
    const colorOf = new Map<string, number>();
    if (region.colorBy) {
      const values = [...new Set(rows.map((r) => resolveValue(rt, region.colorBy!, r, { ...scope, row: r }).text))].sort((a, b) => a.localeCompare(b));
      values.forEach((v, i) => colorOf.set(v, (i % SERIES) + 1));
    }
    const rowsById = new Map<string, Row>();
    const events: ScheduleEvent[] = [];
    for (const r of rows) {
      const start = startField ? parseDate(r[startField.name]) : null;
      if (!start) continue;
      // An open-ended row lasts its hours (a field or derived value named hours) when it has them, else an hour.
      const hours = toNumber(r.hours);
      const end = (endField ? parseDate(r[endField.name]) : null) ?? new Date(start.getTime() + (hours && hours > 0 ? hours : 1) * 36e5);
      if (end <= start) continue;
      const s = { ...scope, row: r };
      const colorText = region.colorBy ? resolveValue(rt, region.colorBy, r, s).text : undefined;
      rowsById.set(r.$key, r);
      events.push({
        id: r.$key,
        start,
        end,
        label: region.label ? resolveValue(rt, region.label, r, s).text : r.$key,
        detail: region.detail ? resolveValue(rt, region.detail, r, s).text : undefined,
        series: colorText ? colorOf.get(colorText) : 1,
        seriesLabel: colorText,
      });
    }
    return { events, rowsById, colors: [...colorOf].map(([label, series]) => ({ label, series })) };
  }, [rt, rec?.id, region, scope, startField, endField]);

  const empty = region.empty
    ? <StatePanel kind="empty" title={text(region.empty.title, scope)}>{region.empty.message ? <p>{text(region.empty.message, scope)}</p> : undefined}</StatePanel>
    : <StatePanel kind="empty" title="Nothing scheduled this week" />;

  const today = parseDate(rt.snapshot.now) ?? new Date();
  const row = chosen ? rowsById.get(chosen.row.$key) ?? chosen.row : null;
  const rowScope: Scope | null = row ? { ...scope, row } : null;
  const actions = row && rowScope ? (region.eventActions ?? []).filter((p) => placementVisible(rt, p, rowScope)) : [];
  // The event's facts: when, its detail, and what its colour stands for (once, when detail already says it).
  const details: Array<{ label: string; value: ReactNode }> = [];
  if (row && rowScope && chosen) {
    details.push({ label: "When", value: `${formatDateTime(chosen.event.start, rt.snapshot.now)} – ${formatClock(chosen.event.end)}` });
    const seen = new Set<string>();
    for (const [vr, fallback] of [[region.detail, "Details"], [region.colorBy, "Category"]] as const) {
      if (!vr) continue;
      const v = resolveValue(rt, vr, row, rowScope);
      const label = valueLabel(rt, vr) || fallback;
      if (seen.has(`${label}\u0000${v.text}`)) continue;
      seen.add(`${label}\u0000${v.text}`);
      details.push({ label, value: renderResolved(v) });
    }
  }

  return (
    <>
      <WeekSchedule
        label={title || rec?.title || "Schedule"}
        events={events}
        today={today}
        hours={region.hours}
        colors={region.colorBy ? colors : []}
        legend={region.legend}
        empty={empty}
        onSelect={(event) => { const r = rowsById.get(event.id); if (r) { setChosen({ row: r, event }); setOpen(true); } }}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title={chosen?.event.label ?? ""}
        actions={
          <>
            {row && rowScope && actions.map((p, i) => (
              <Button key={`${p.action}-${i}`} variant={p.emphasis === "primary" ? "primary" : "secondary"}
                onClick={() => { setOpen(false); void request(p, { scope: rowScope, row, screenKey }); }}>
                {actionLabel(rt, p)}
              </Button>
            ))}
            <Button variant={actions.length ? "text" : "secondary"} onClick={() => setOpen(false)}>Close</Button>
          </>
        }>
        {row && <DescriptionList items={details} />}
      </Dialog>
    </>
  );
}
