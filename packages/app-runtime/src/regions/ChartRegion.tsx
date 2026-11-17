/* A chart region: a record's rows (those the person may see, after the
   region's filter) grouped by one value, optionally into date periods, with
   one measure per group, drawn in ux-builder's ChartFrame with the same
   numbers as a table beside it.

   One series, so one colour: the theme's first series colour; text wears
   text tokens, never the series colour. Bars are at most 24px thick with a
   4px rounded end and a square base; lines are 2px; gridlines are hairlines.
   A tooltip follows the pointer; the table serves keyboards, screen readers
   and anyone who wants the figures. */
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChartFrame } from "@ux-builder/ui/patterns";
import { useApp } from "../context";
import type { Format, Region, ValueRef } from "../definition";
import { formatValue } from "../format";
import { rawValue, resolveValue, ruleHolds, rowsOf, text, valueFormat, valueLabel, type Runtime, type Scope } from "../runtime";
import { chartData, niceTicks, type Aggregate, type Bucket, type ChartPoint } from "../chart-data";

type Measure = { aggregate: Aggregate; field?: { module: string; element: string }; derived?: string; label?: string; format?: Format };
export type ChartRegionSpec = Region & { chart?: "bar" | "column" | "line"; measure?: Measure; bucket?: Bucket; limit?: number };

const AGG_WORD: Record<Aggregate, string> = { count: "Number", sum: "Total", average: "Average", min: "Lowest", max: "Highest" };
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/* The numbers a chart region shows, for its rows. */
export function chartOf(rt: Runtime, region: ChartRegionSpec, scope: Scope) {
  const rec = region.record ? rt.idx.record(region.record) : undefined;
  const m: Measure = region.measure ?? { aggregate: "count" };
  const group: ValueRef = region.groupBy ?? {};
  const measureRef: ValueRef | null = m.field ? { field: m.field } : m.derived ? { derived: m.derived } : null;
  const format: Format = m.format ?? (m.aggregate === "count" || !measureRef ? "number" : valueFormat(rt, measureRef));
  const rows = rowsOf(rt, rec?.id).filter((r) => ruleHolds(region.filter, { ...scope, row: r }));
  const labels = new Map<string, string>();
  const items = rows.map((r) => {
    const g = rawValue(rt, group, r, scope);
    if (!region.bucket && g != null && g !== "" && !labels.has(String(g))) labels.set(String(g), resolveValue(rt, group, r, scope).text);
    return { group: g, value: measureRef ? rawValue(rt, measureRef, r, scope) : undefined };
  });
  const points = chartData(items, { aggregate: m.aggregate, bucket: region.bucket, limit: region.limit, labelOf: (g) => labels.get(String(g)) ?? String(g) });
  const groupLabel = region.groupBy ? valueLabel(rt, group) || "Group" : "Group";
  const measureLabel = m.label ?? (m.aggregate === "count" ? `Number of ${lower(rec?.title ?? "rows")}${/s$/.test(rec?.title ?? "") ? "" : "s"}` : `${AGG_WORD[m.aggregate]} ${lower(measureRef ? valueLabel(rt, measureRef) : "value")}`);
  return { rows: rows.length, points, format, groupLabel: region.bucket ? `${region.bucket.charAt(0).toUpperCase()}${region.bucket.slice(1)}` : groupLabel, measureLabel };
}

export function ChartRegion({ region, scope }: { region: ChartRegionSpec; scope: Scope }) {
  const { rt, loading } = useApp();
  const kind = region.chart ?? (region.bucket ? "line" : "bar");
  const data = useMemo(() => (loading ? null : chartOf(rt, region, scope)), [rt, region, scope, loading]);
  const title = region.title ? text(region.title, scope) : data ? `${data.measureLabel} by ${lower(data.groupLabel)}` : "";
  const description = region.description ? text(region.description, scope) : undefined;
  const fmt = (v: number | null) => formatValue(v, data?.format ?? "number", rt.snapshot.now);
  const shown = data?.points.filter((p) => p.value !== null) ?? [];
  const status = loading ? "loading" : !data || !shown.length ? "empty" : "ready";
  const table = data && status === "ready" ? {
    columns: [{ key: "label", label: data.groupLabel }, { key: "value", label: data.measureLabel, numeric: true }],
    rows: data.points.map((p) => ({ label: p.label, value: fmt(p.value) })),
  } : undefined;
  return (
    <ChartFrame className="app-rt-chart" title={title} description={description} status={status} table={table} emptyTitle={region.empty ? text(region.empty.title, scope) : "Nothing to show yet"}>
      {data && status === "ready" && <ChartSvg kind={kind} points={data.points} format={data.format} fmt={fmt} title={title} measureLabel={data.measureLabel} groupLabel={data.groupLabel} time={!!region.bucket} />}
    </ChartFrame>
  );
}

/* ---------- drawing ---------- */

const CHAR = 7; // average width of a small-text character, px
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const compactCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/* Axis ticks: in full under 10,000, compact on an axis that reaches it (one style per axis). */
function tickText(v: number, format: Format, top: number) {
  if (Math.abs(top) < 10000 || format === "percent") return formatValue(v, format);
  if (format === "currency") return compactCurrency.format(v);
  return `${compactNumber.format(v)}${format === "hours" ? " h" : ""}`;
}

/* A bar or column with a 4px rounded data end and a square base. */
function barPath(x: number, y: number, w: number, h: number, end: "right" | "top") {
  const r = Math.max(0, Math.min(4, (end === "right" ? w : h) / 2, (end === "right" ? h : w) / 2));
  if (end === "right") return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

type Tip = { x: number; y: number; point: ChartPoint } | null;

function ChartSvg({ kind, points, format, fmt, title, measureLabel, groupLabel, time }: { kind: "bar" | "column" | "line"; points: ChartPoint[]; format: Format; fmt: (v: number | null) => string; title: string; measureLabel: string; groupLabel: string; time: boolean }) {
  const { ref, width } = useWidth();
  const [tip, setTip] = useState<Tip>(null);
  const id = useId();
  const values = points.map((p) => p.value ?? 0);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const top = points.reduce((a, p) => ((p.value ?? -Infinity) > (a?.value ?? -Infinity) ? p : a), points[0]);
  const summary = `${title}. ${kind === "line" ? "Line" : kind === "column" ? "Column" : "Bar"} chart of ${lower(measureLabel)} by ${lower(groupLabel)}, ${points.length} ${time ? "periods" : "groups"}${time && points.length ? ` from ${points[0].label} to ${points[points.length - 1].label}` : ""}. Highest: ${top?.label}, ${fmt(top?.value ?? null)}.`;

  let svg;
  if (kind === "bar") {
    const rowH = 32, barH = 20;
    const labelW = Math.min(Math.round(width * 0.4), Math.max(72, Math.max(...points.map((p) => p.label.length)) * CHAR + 12));
    const valueW = Math.max(...points.map((p) => fmt(p.value).length)) * CHAR + 12;
    const x0 = labelW, plotW = Math.max(40, width - labelW - valueW);
    const sx = (v: number) => x0 + ((v - lo) / (hi - lo || 1)) * plotW;
    const height = points.length * rowH + 8;
    const maxChars = Math.floor((labelW - 12) / CHAR);
    svg = (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-sum`} className="app-rt-chart__svg">
        <title id={`${id}-sum`}>{summary}</title>
        <line x1={sx(0)} x2={sx(0)} y1={0} y2={height - 4} className="app-rt-chart__axis" />
        {points.map((p, i) => {
          const y = 4 + i * rowH + (rowH - barH) / 2;
          const v = p.value ?? 0;
          const x = Math.min(sx(0), sx(v)), w = Math.max(1, Math.abs(sx(v) - sx(0)));
          const label = p.label.length > maxChars ? `${p.label.slice(0, Math.max(1, maxChars - 1))}…` : p.label;
          return (
            <g key={p.key} onPointerEnter={() => setTip({ x: x + w + fmt(p.value).length * CHAR + 8, y: Math.max(0, y - 10), point: p })} onPointerLeave={() => setTip(null)}>
              <rect x={0} y={4 + i * rowH} width={width} height={rowH} className="app-rt-chart__hit" />
              <text x={labelW - 10} y={y + barH / 2} className="app-rt-chart__label" textAnchor="end" dominantBaseline="central">{label}</text>
              {v !== 0 && <path d={barPath(x, y, w, barH, "right")} className={`app-rt-chart__mark${p.other ? " app-rt-chart__mark--other" : ""}`} />}
              <text x={x + w + 6} y={y + barH / 2} className="app-rt-chart__value" dominantBaseline="central">{fmt(p.value)}</text>
            </g>
          );
        })}
      </svg>
    );
  } else {
    const height = 260, padTop = 12, padBottom = 30;
    const left = Math.max(...ticks.map((t) => tickText(t, format, hi).length)) * CHAR + 12;
    const right = kind === "line" ? Math.max(16, fmt(points[points.length - 1]?.value ?? null).length * CHAR / 2) : 8;
    const plotW = Math.max(60, width - left - right), plotH = height - padTop - padBottom;
    const band = plotW / Math.max(1, points.length);
    const cx = (i: number) => left + (i + 0.5) * band;
    const sy = (v: number) => padTop + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
    // Show every k-th period or category name so labels never collide.
    const longest = Math.max(...points.map((p) => shortLabel(p.label, time).length)) * CHAR + 10;
    const every = Math.max(1, Math.ceil(longest / band));
    const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
      const i = Math.max(0, Math.min(points.length - 1, Math.floor((e.clientX - box.left - left) / band)));
      const p = points[i];
      setTip({ x: cx(i), y: padTop, point: p });
    };
    const segments: string[] = [];
    let current = "";
    points.forEach((p, i) => {
      if (p.value == null) { if (current) segments.push(current); current = ""; return; }
      current += `${current ? "L" : "M"}${cx(i)},${sy(p.value)}`;
    });
    if (current) segments.push(current);
    const lastIdx = [...points.keys()].reverse().find((i) => points[i].value != null) ?? -1;
    svg = (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-sum`} className="app-rt-chart__svg">
        <title id={`${id}-sum`}>{summary}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={sy(t)} y2={sy(t)} className={t === 0 ? "app-rt-chart__axis" : "app-rt-chart__grid"} />
            <text x={left - 8} y={sy(t)} className="app-rt-chart__tick" textAnchor="end" dominantBaseline="central">{tickText(t, format, hi)}</text>
          </g>
        ))}
        {points.map((p, i) => i % every === 0 ? (
          <text key={p.key} x={cx(i)} y={height - 10} className="app-rt-chart__tick" textAnchor="middle">{shortLabel(p.label, time)}</text>
        ) : null)}
        {kind === "column" && points.map((p, i) => {
          if (!p.value) return null; // nothing, or zero: no mark
          const w = Math.max(2, Math.min(24, band - 2));
          const y = Math.min(sy(0), sy(p.value)), h = Math.max(1, Math.abs(sy(p.value) - sy(0)));
          return <path key={p.key} d={barPath(cx(i) - w / 2, y, w, h, "top")} className={`app-rt-chart__mark${p.other ? " app-rt-chart__mark--other" : ""}${tip?.point.key === p.key ? " is-active" : ""}`} />;
        })}
        {kind === "line" && (
          <>
            {segments.map((d, i) => <path key={`a${i}`} d={`${d}V${sy(Math.max(lo, 0))}H${d.split(",")[0].slice(1)}Z`} className="app-rt-chart__area" />)}
            {segments.map((d, i) => <path key={`l${i}`} d={d} className="app-rt-chart__line" />)}
            {points.length <= 16 && points.map((p, i) => p.value == null ? null : <circle key={p.key} cx={cx(i)} cy={sy(p.value)} r={3} className="app-rt-chart__dot" />)}
            {lastIdx >= 0 && <circle cx={cx(lastIdx)} cy={sy(points[lastIdx].value!)} r={4} className="app-rt-chart__dot app-rt-chart__dot--end" />}
          </>
        )}
        {tip && kind === "line" && <line x1={tip.x} x2={tip.x} y1={padTop} y2={padTop + plotH} className="app-rt-chart__crosshair" />}
        {tip && kind === "line" && tip.point.value != null && <circle cx={tip.x} cy={sy(tip.point.value)} r={5} className="app-rt-chart__dot app-rt-chart__dot--end" />}
        <rect x={left} y={padTop} width={plotW} height={plotH} className="app-rt-chart__hit" onPointerMove={onMove} onPointerLeave={() => setTip(null)} />
      </svg>
    );
  }
  return (
    <div ref={ref} className="app-rt-chart__plot">
      {svg}
      {tip && (
        // Beside the mark or crosshair, never over it: to its right, or to its left near the right edge.
        <div className="app-rt-chart__tip" role="presentation" style={tip.x + 12 + 180 <= width ? { left: tip.x + 12, top: tip.y } : { right: width - tip.x + 12, top: tip.y }}>
          <span className="app-rt-chart__tip-label">{tip.point.label}</span>
          <span className="app-rt-chart__tip-value">{fmt(tip.point.value)}</span>
          {!tip.point.other && tip.point.rows > 0 && <span className="app-rt-chart__tip-rows">{tip.point.rows} {tip.point.rows === 1 ? "row" : "rows"}</span>}
        </div>
      )}
    </div>
  );
}

/* A period's axis label: "Jan 2026" → "Jan 26"; categories as they are. */
function shortLabel(label: string, time: boolean) {
  if (!time) return label.length > 14 ? `${label.slice(0, 13)}…` : label;
  return label.replace(/^Week of /, "").replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /, "").replace(/ (\d{2})(\d{2})$/, " ’$2");
}
