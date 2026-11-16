/* A week as a time grid: a column per day, Monday to Sunday, hour rows, and
   each event a block placed and sized by its start and end. @ux-builder/ui's
   Calendar lists a week's events but has no time grid, so the renderer draws
   this one from plain elements styled with role tokens (runtime.css).

   - Events are buttons, in reading order (day by day, by start time), each
     inside its day's section, which is labelled by the day's heading.
   - Overlapping events share their day's width side by side.
   - Colour is never the only signal: the colour's meaning is in the legend
     and in each event's accessible name.
   - Where the grid has less than 600px (its own width, not the window's) it
     becomes an agenda: the week's days with their events as a list.
   - Times are wall-clock values stored as UTC ("…T09:00:00Z" is 9:00 for
     everyone), so every day boundary and label is computed in UTC. */
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Icon } from "@ux-builder/ui";
import { useSizeClass } from "@ux-builder/ui/patterns";
import { formatClock, formatDay } from "./format";

export interface ScheduleEvent {
  id: string;
  start: Date;
  end: Date;
  label: string;
  detail?: string;
  /** The colour: 1 to 8, one of the theme's --piq-color-series-N. */
  series?: number;
  /** What the colour stands for, for the accessible name. */
  seriesLabel?: string;
}

export interface WeekScheduleProps {
  events: ScheduleEvent[];
  /** The clock the app runs at: the first week shown is the one containing it, and its day is marked Today. */
  today: Date;
  /** The hours shown, [from, to); widened to fit any event of the week. Default 8 to 18. */
  hours?: { from?: number; to?: number };
  /** Called when an event is chosen. */
  onSelect?(event: ScheduleEvent): void;
  /** The accessible name of the schedule. */
  label: string;
  /** Colour key: what each series colour stands for. */
  colors?: Array<{ series: number; label: string }>;
  /** Extra legend lines. */
  legend?: Array<{ label: string; description?: string }>;
  /** Shown instead of the grid when the week has no events. */
  empty?: ReactNode;
  className?: string;
}

const MAX_SERIES = 8;

/** Midnight (UTC) of the day of `d`. */
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Monday 00:00 (UTC) of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = dayOf(d);
  s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7));
  return s;
}

const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
const sameDay = (a: Date, b: Date) => dayOf(a).getTime() === dayOf(b).getTime();
const minutesOf = (d: Date, day: Date) => (d.getTime() - day.getTime()) / 6e4;

const monthDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthDayYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "9–15 Nov 2026", or "30 Nov – 6 Dec 2026" across months. */
export function weekRangeLabel(start: Date): string {
  const end = addDays(start, 6);
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) return `${start.getUTCDate()}–${monthDayYear.format(end)}`;
  return `${start.getUTCFullYear() === end.getUTCFullYear() ? monthDay.format(start) : monthDayYear.format(start)} – ${monthDayYear.format(end)}`;
}

interface Placed {
  event: ScheduleEvent;
  top: number; // minutes from midnight
  length: number; // minutes
  lane: number;
  lanes: number;
}

/* Events of one day, clipped to the day (minutes from midnight), with side-by-side lanes for overlaps. */
function placeDay(events: ScheduleEvent[], day: Date): Placed[] {
  const next = addDays(day, 1);
  const parts = events
    .filter((e) => e.start < next && e.end > day)
    .map((e) => {
      const s = Math.max(0, minutesOf(e.start < day ? day : e.start, day));
      const t = Math.min(1440, minutesOf(e.end > next ? next : e.end, day));
      return { event: e, s, t: Math.max(t, Math.min(1440, s + 15)) };
    })
    .sort((a, b) => a.s - b.s || b.t - a.t);
  // Group overlapping runs; inside a run, give each event the first free lane.
  const out: Placed[] = [];
  let run: Array<{ p: Placed; t: number }> = [];
  let runEnd = -Infinity;
  const flush = () => {
    const lanes = run.reduce((n, x) => Math.max(n, x.p.lane + 1), 0);
    for (const x of run) x.p.lanes = lanes;
    run = [];
  };
  for (const x of parts) {
    if (x.s >= runEnd) { flush(); runEnd = -Infinity; }
    const busy = new Set(run.filter((r) => r.t > x.s).map((r) => r.p.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    const p: Placed = { event: x.event, top: x.s, length: x.t - x.s, lane, lanes: 1 };
    run.push({ p, t: x.t });
    out.push(p);
    runEnd = Math.max(runEnd, x.t);
  }
  flush();
  return out;
}

const seriesStyle = (n?: number): CSSProperties | undefined =>
  n ? ({ "--app-rt-series": `var(--piq-color-series-${((n - 1) % MAX_SERIES) + 1})` } as CSSProperties) : undefined;

const timeRange = (e: ScheduleEvent) => `${formatClock(e.start)}–${formatClock(e.end)}`;

export function WeekSchedule({ events, today, hours, onSelect, label, colors = [], legend = [], empty, className }: WeekScheduleProps) {
  const root = useRef<HTMLDivElement>(null);
  const size = useSizeClass(root);
  const ids = useId();
  const [week, setWeek] = useState(() => startOfWeek(today));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const weekEnd = addDays(week, 7);
  const inWeek = useMemo(() => events.filter((e) => e.start < weekEnd && e.end > week).sort((a, b) => a.start.getTime() - b.start.getTime()), [events, week]); // eslint-disable-line react-hooks/exhaustive-deps

  // The hours shown: the configured span, widened to fit this week's events.
  const perDay = useMemo(() => days.map((d) => placeDay(inWeek, d)), [days, inWeek]);
  let from = Math.max(0, Math.min(23, hours?.from ?? 8));
  let to = Math.max(from + 1, Math.min(24, hours?.to ?? 18));
  for (const p of perDay.flat()) {
    from = Math.min(from, Math.floor(p.top / 60));
    to = Math.max(to, Math.ceil((p.top + p.length) / 60));
  }
  const fromMin = from * 60, toMin = to * 60, span = toMin - fromMin;
  const hourList = Array.from({ length: to - from }, (_, i) => from + i);
  const isThisWeek = sameDay(week, startOfWeek(today));

  const eventName = (e: ScheduleEvent, day?: Date) =>
    [...new Set([day ? longDay.format(day) : undefined, timeRange(e), e.label, e.detail, e.seriesLabel].filter(Boolean))].join(", ");

  const toolbar = (
    <div className="app-rt-week__toolbar">
      <p className="app-rt-week__range" aria-live="polite" id={`${ids}-range`}>
        {weekRangeLabel(week)}
        {isThisWeek && <span className="app-rt-week__badge">This week</span>}
      </p>
      <div className="app-rt-week__nav">
        <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><Icon name="chevron-left" /></Button>
        <Button variant="secondary" size="sm" disabled={isThisWeek} onClick={() => setWeek(startOfWeek(today))}>This week</Button>
        <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><Icon name="chevron-right" /></Button>
      </div>
    </div>
  );

  const key = (colors.length > 0 || legend.length > 0) && (
    <div className="app-rt-week__legend">
      {colors.length > 0 && (
        <ul className="app-rt-week__key" aria-label="Colour key">
          {colors.map((c) => (
            <li key={c.series} className="app-rt-week__key-item" style={seriesStyle(c.series)}>
              <span className="app-rt-week__swatch" aria-hidden="true" />
              {c.label}
            </li>
          ))}
        </ul>
      )}
      {legend.map((l, i) => (
        <p key={i} className="app-rt-week__note"><strong>{l.label}</strong>{l.description ? ` ${l.description}` : null}</p>
      ))}
    </div>
  );

  let body: ReactNode;
  if (!inWeek.length) {
    body = empty;
  } else if (size === "compact") {
    body = (
      <ol className="app-rt-agenda" aria-labelledby={`${ids}-range`}>
        {days.map((d, i) => {
          const list = inWeek.filter((e) => e.start < addDays(d, 1) && e.end > d);
          if (!list.length) return null;
          const today_ = sameDay(d, today);
          return (
            <li key={i} className="app-rt-agenda__day">
              <h3 className="app-rt-agenda__heading" id={`${ids}-a${i}`}>
                {formatDay(d)}
                {today_ && <span className="app-rt-week__badge">Today</span>}
              </h3>
              <ul className="app-rt-agenda__events" aria-labelledby={`${ids}-a${i}`}>
                {list.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="app-rt-agenda__event" style={seriesStyle(e.series)} aria-label={eventName(e)} onClick={() => onSelect?.(e)}>
                      <span className="app-rt-agenda__time">{timeRange(e)}</span>
                      <span className="app-rt-agenda__label">{e.label}</span>
                      {e.detail && <span className="app-rt-agenda__detail">{e.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    );
  } else {
    const nowMin = isThisWeek ? minutesOf(today, dayOf(today)) : -1;
    body = (
      <div className="app-rt-week__grid" style={{ "--app-rt-hours": String(to - from) } as CSSProperties}>
        <div className="app-rt-week__corner" aria-hidden="true" />
        {days.map((d, i) => (
          <h3 key={i} id={`${ids}-d${i}`} className="app-rt-week__dayhead" data-today={sameDay(d, today) || undefined}>
            <span className="app-rt-week__weekday">{weekday.format(d)}</span>
            <span className="app-rt-week__date">{d.getUTCDate()}</span>
            {sameDay(d, today) && <span className="app-rt-week__badge">Today</span>}
          </h3>
        ))}
        <div className="app-rt-week__gutter" aria-hidden="true">
          {hourList.map((h) => <span key={h} className="app-rt-week__hour">{`${String(h).padStart(2, "0")}:00`}</span>)}
        </div>
        {days.map((d, i) => {
          const placed = perDay[i];
          const today_ = sameDay(d, today);
          return (
            <section key={i} className="app-rt-week__day" aria-labelledby={`${ids}-d${i}`} data-today={today_ || undefined}>
              {hourList.map((h) => <span key={h} className="app-rt-week__slot" aria-hidden="true" />)}
              {today_ && nowMin >= fromMin && nowMin <= toMin && (
                <span className="app-rt-week__now" style={{ top: `${((nowMin - fromMin) / span) * 100}%` }} aria-hidden="true" />
              )}
              {placed.length > 0 && (
                <ul className="app-rt-week__events">
                  {placed.map((p) => (
                    <li key={p.event.id} className="app-rt-week__slotted"
                      style={{ top: `${((p.top - fromMin) / span) * 100}%`, height: `${(p.length / span) * 100}%`, left: `${(p.lane / p.lanes) * 100}%`, width: `${100 / p.lanes}%` }}>
                      <button type="button" className="app-rt-week__event" style={seriesStyle(p.event.series)} data-short={p.length < 45 || undefined}
                        aria-label={eventName(p.event, d)} onClick={() => onSelect?.(p.event)}>
                        <span className="app-rt-week__event-label">{p.event.label}</span>
                        <span className="app-rt-week__event-time">{timeRange(p.event)}</span>
                        {p.event.detail && <span className="app-rt-week__event-detail">{p.event.detail}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={root} role="group" aria-label={label} className={`app-rt-week${className ? ` ${className}` : ""}`} data-size={size}>
      {toolbar}
      {body}
      {inWeek.length > 0 && key}
    </div>
  );
}
