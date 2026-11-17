/* What a chart region shows, worked out from rows: each row's group (a value,
   or a date period when the chart has a bucket) and its measure, aggregated
   per group. Pure, so the numbers can be tested without rendering, and the
   chart and its data table always show the same ones.

   - Periods are in time order, with the empty periods between the first and
     the last filled in (zero for a count or sum; no value for an average,
     minimum or maximum, which have nothing to say about an empty period);
     a limit keeps the latest.
   - Categories are largest first; a limit keeps the largest and folds the
     rest into "Other" when the measure adds up (count, sum). */

export type Aggregate = "count" | "sum" | "average" | "min" | "max";
export type Bucket = "day" | "week" | "month" | "quarter" | "year";
export type ChartPoint = { key: string; label: string; value: number | null; rows: number; other?: true };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" || !v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The period a date falls in, as a sortable key: 2026-01-05 (day; a week by its Monday), 2026-01, 2026-Q1, 2026. */
export function periodKey(v: unknown, bucket: Bucket): string | null {
  const d = toDate(v);
  if (!d) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (bucket) {
    case "day": return dayKey(d);
    case "week": { const monday = new Date(Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7))); return dayKey(monday); }
    case "month": return `${y}-${pad(m + 1)}`;
    case "quarter": return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "year": return String(y);
  }
}

/** The period after a period key. */
export function nextPeriod(key: string, bucket: Bucket): string {
  if (bucket === "year") return String(Number(key) + 1);
  if (bucket === "quarter") { const [y, q] = key.split("-Q").map(Number); return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`; }
  if (bucket === "month") { const [y, m] = key.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; }
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (bucket === "week" ? 7 : 1));
  return dayKey(d);
}

/** A period key as people read it: "Mon 5 Jan 2026", "Week of 5 Jan 2026", "Jan 2026", "Q1 2026", "2026". */
export function periodLabel(key: string, bucket: Bucket): string {
  if (bucket === "year") return key;
  if (bucket === "quarter") { const [y, q] = key.split("-Q"); return `Q${q} ${y}`; }
  if (bucket === "month") { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; }
  const d = new Date(`${key}T00:00:00Z`);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return bucket === "week" ? `Week of ${day}` : `${DAYS[d.getUTCDay()]} ${day}`;
}

const number = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

export interface ChartDataOptions {
  aggregate: Aggregate;
  bucket?: Bucket;
  limit?: number;
  /** How a category reads (choice values as words, keys as names…). */
  labelOf?: (group: unknown) => string;
  /** The label for rows with no group value. */
  noneLabel?: string;
}

/** Group the items, aggregate each group, order and limit them. Items: one per row, its group value and its measure value. */
export function chartData(items: Array<{ group: unknown; value?: unknown }>, { aggregate, bucket, limit, labelOf = (g) => String(g), noneLabel = "None" }: ChartDataOptions): ChartPoint[] {
  const groups = new Map<string, { label: string; values: number[]; rows: number }>();
  for (const it of items) {
    let key: string;
    let label: string;
    if (bucket) {
      const k = periodKey(it.group, bucket);
      if (!k) continue; // A row without a date has no place in time.
      key = k;
      label = periodLabel(k, bucket);
    } else {
      const none = it.group === null || it.group === undefined || it.group === "";
      key = none ? "\u0000none" : String(it.group);
      label = none ? noneLabel : labelOf(it.group);
    }
    const g = groups.get(key) ?? (groups.set(key, { label, values: [], rows: 0 }), groups.get(key)!);
    g.rows++;
    if (aggregate !== "count") { const n = number(it.value); if (n !== null) g.values.push(n); }
  }
  const reduce = (g: { values: number[]; rows: number }): number | null => {
    switch (aggregate) {
      case "count": return g.rows;
      case "sum": return g.values.reduce((a, b) => a + b, 0);
      case "average": return g.values.length ? g.values.reduce((a, b) => a + b, 0) / g.values.length : null;
      case "min": return g.values.length ? Math.min(...g.values) : null;
      case "max": return g.values.length ? Math.max(...g.values) : null;
    }
  };
  let points: ChartPoint[] = [...groups].map(([key, g]) => ({ key, label: g.label, value: reduce(g), rows: g.rows }));
  const adds = aggregate === "count" || aggregate === "sum";

  if (bucket) {
    points.sort((a, b) => a.key.localeCompare(b.key));
    if (points.length > 1) {
      const filled: ChartPoint[] = [];
      const byKey = new Map(points.map((p) => [p.key, p]));
      const last = points[points.length - 1].key;
      for (let k = points[0].key, guard = 0; guard < 5000; k = nextPeriod(k, bucket), guard++) {
        filled.push(byKey.get(k) ?? { key: k, label: periodLabel(k, bucket), value: adds ? 0 : null, rows: 0 });
        if (k === last) break;
      }
      points = filled;
    }
    if (limit && points.length > limit) points = points.slice(points.length - limit);
    return points;
  }

  const none = (p: ChartPoint) => (p.key === "\u0000none" ? 1 : 0);
  points.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || none(a) - none(b) || a.label.localeCompare(b.label));
  if (limit && points.length > limit) {
    const kept = points.slice(0, adds ? Math.max(1, limit - 1) : limit);
    if (adds) {
      const rest = points.slice(kept.length);
      kept.push({ key: "\u0000other", label: `Other (${rest.length})`, value: rest.reduce((t, p) => t + (p.value ?? 0), 0), rows: rest.reduce((t, p) => t + p.rows, 0), other: true });
    }
    points = kept;
  }
  return points;
}

/** Round axis ticks from zero (or a negative minimum) to just past the maximum. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
