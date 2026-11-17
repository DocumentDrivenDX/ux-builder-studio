/* A chart region's numbers (packages/app-runtime/src/chart-data.ts): rows
   grouped by a value or a date period, one measure per group; periods in
   time order with the empty ones filled in; categories largest first, the
   rest folded into "Other"; round axis ticks. */
import test from "node:test";
import assert from "node:assert/strict";
import { chartData, niceTicks, nextPeriod, periodKey, periodLabel } from "../../../packages/app-runtime/src/chart-data.ts";

test("periods: a date's day, week (from Monday), month, quarter and year, and how they read", () => {
  assert.equal(periodKey("2026-01-08", "day"), "2026-01-08");
  assert.equal(periodKey("2026-01-08", "week"), "2026-01-05");
  assert.equal(periodKey("2026-01-04T23:30:00Z", "week"), "2025-12-29", "a Sunday belongs to the week that began on Monday");
  assert.equal(periodKey("2026-05-31", "month"), "2026-05");
  assert.equal(periodKey("2026-11-17", "quarter"), "2026-Q4");
  assert.equal(periodKey("2026-11-17", "year"), "2026");
  assert.equal(periodKey(null, "month"), null);
  assert.equal(nextPeriod("2026-12", "month"), "2027-01");
  assert.equal(nextPeriod("2026-Q4", "quarter"), "2027-Q1");
  assert.equal(nextPeriod("2026-12-28", "week"), "2027-01-04");
  assert.equal(periodLabel("2026-01", "month"), "Jan 2026");
  assert.equal(periodLabel("2026-Q3", "quarter"), "Q3 2026");
  assert.equal(periodLabel("2026-01-05", "week"), "Week of 5 Jan 2026");
});

test("sums by month, in time order, with an empty month in between at zero", () => {
  const rows = [
    { group: "2026-03-02", value: 100 }, { group: "2026-01-15", value: 40 }, { group: "2026-01-20", value: "60" },
    { group: null, value: 999 }, // no date: no place in time
  ];
  assert.deepEqual(chartData(rows, { aggregate: "sum", bucket: "month" }).map((p) => [p.label, p.value, p.rows]), [["Jan 2026", 100, 2], ["Feb 2026", 0, 0], ["Mar 2026", 100, 1]]);
  // An average has nothing to say about an empty month.
  assert.deepEqual(chartData(rows, { aggregate: "average", bucket: "month" }).map((p) => p.value), [50, null, 100]);
  // A limit keeps the latest periods.
  assert.deepEqual(chartData(rows, { aggregate: "count", bucket: "month", limit: 2 }).map((p) => p.label), ["Feb 2026", "Mar 2026"]);
});

test("counts by category, largest first; a limit keeps the largest and folds the rest into Other", () => {
  const groups = ["open", "open", "open", "closed", "closed", "on hold", "", "draft"];
  const all = chartData(groups.map((g) => ({ group: g })), { aggregate: "count", labelOf: (g) => String(g).toUpperCase() });
  assert.deepEqual(all.map((p) => [p.label, p.value]), [["OPEN", 3], ["CLOSED", 2], ["DRAFT", 1], ["ON HOLD", 1], ["None", 1]]);
  const top = chartData(groups.map((g) => ({ group: g })), { aggregate: "count", limit: 3 });
  assert.deepEqual(top.map((p) => [p.label, p.value, !!p.other]), [["open", 3, false], ["closed", 2, false], ["Other (3)", 3, true]]);
  // Min and max don't add up, so nothing is folded.
  const max = chartData([{ group: "a", value: 5 }, { group: "b", value: 9 }, { group: "c", value: 1 }], { aggregate: "max", limit: 2 });
  assert.deepEqual(max.map((p) => [p.label, p.value]), [["b", 9], ["a", 5]]);
});

test("axis ticks are round numbers from zero to just past the largest value", () => {
  assert.deepEqual(niceTicks(0, 87), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(0, 412_000), [0, 200000, 400000, 600000]);
  assert.deepEqual(niceTicks(-30, 70), [-50, -25, 0, 25, 50, 75]);
  assert.deepEqual(niceTicks(0, 0), [0, 1]);
});
