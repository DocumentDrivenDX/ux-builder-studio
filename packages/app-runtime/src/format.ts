/* Display formats for values from a definition: currency, hours, dates,
   date-times, times, numbers and percentages. Dates ("YYYY-MM-DD") and
   timestamps are wall-clock values: a timestamp is stored as an ISO string
   with "Z" ("2026-11-09T09:00:00Z" means 9:00 on 9 November wherever the
   viewer is), so everything is formatted in UTC and nothing shifts with the
   viewer's time zone. */

import type { Format } from "./definition";

/** Text shown for a missing value. */
export const EMPTY = "—";

const DATE_LOCALE = "en-GB"; // "Mon 9 Nov"
const NUMBER_LOCALE = "en-US";

const currencyFormat = new Intl.NumberFormat(NUMBER_LOCALE, { style: "currency", currency: "USD" });
const numberFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 2 });
const hoursFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat(NUMBER_LOCALE, { style: "percent", maximumFractionDigits: 1 });
const dayFormat = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayYearFormat = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const clockFormat = new Intl.DateTimeFormat(DATE_LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** "$1,234.50" */
export function formatCurrency(v: unknown): string {
  const n = toNumber(v);
  return n === null ? EMPTY : currencyFormat.format(n);
}

/** "1.5 h" */
export function formatHours(v: unknown): string {
  const n = toNumber(v);
  return n === null ? EMPTY : `${hoursFormat.format(n)} h`;
}

/** "1,234.5" */
export function formatNumber(v: unknown): string {
  const n = toNumber(v);
  return n === null ? EMPTY : numberFormat.format(n);
}

/** A fraction as a percentage: 0.25 → "25%". */
export function formatPercent(v: unknown): string {
  const n = toNumber(v);
  return n === null ? EMPTY : percentFormat.format(n);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day ("YYYY-MM-DD") as a UTC midnight Date, or a timestamp as its instant. */
export function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(DATE_ONLY.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A day: "Mon 9 Nov" (with the year when it is not the year of `now`). */
export function formatDate(v: unknown, now?: string | Date): string {
  if (isBlank(v)) return EMPTY;
  const d = parseDate(v);
  if (!d) return String(v);
  const year = yearOf(now);
  return (year === null || d.getUTCFullYear() === year ? dayFormat : dayYearFormat).format(d);
}

/** A wall-clock date and time: "Mon 9 Nov, 09:30". */
export function formatDateTime(v: unknown, now?: string | Date): string {
  if (isBlank(v)) return EMPTY;
  const d = parseDate(v);
  if (!d) return String(v);
  return `${formatDate(d, now)}, ${clockFormat.format(d)}`;
}

/** A time of day ("HH:MM[:SS]") or the clock time of an instant: "09:30". */
export function formatTime(v: unknown): string {
  if (isBlank(v)) return EMPTY;
  const s = String(v);
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m && !s.includes("T")) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const d = parseDate(s);
  return d ? clockFormat.format(d) : s;
}

/** The wall-clock time of a Date: "09:30". */
export const formatClock = (d: Date) => clockFormat.format(d);

/** The wall-clock day of a Date: "Mon 9 Nov". */
export const formatDay = (d: Date) => dayFormat.format(d);

function yearOf(now?: string | Date): number | null {
  if (!now) return null;
  const d = parseDate(now instanceof Date ? now : String(now));
  return d ? d.getUTCFullYear() : null;
}

/** A value as text in a format; `status` and `email` fall back to the text. */
export function formatValue(v: unknown, format: Format | undefined, now?: string | Date): string {
  if (isBlank(v)) return EMPTY;
  if (Array.isArray(v)) return v.length ? v.map((x) => formatValue(x, format, now)).join(", ") : EMPTY;
  switch (format) {
    case "currency": return formatCurrency(v);
    case "hours": return formatHours(v);
    case "number": return formatNumber(v);
    case "percent": return formatPercent(v);
    case "date": return formatDate(v, now);
    case "datetime": return formatDateTime(v, now);
    case "time": return formatTime(v);
    default:
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (typeof v === "number") return formatNumber(v);
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
  }
}

/** Formats whose values are numbers, right-aligned in tables. */
export const NUMERIC_FORMATS: ReadonlySet<Format> = new Set<Format>(["currency", "hours", "number", "percent"]);
