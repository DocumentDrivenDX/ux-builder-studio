#!/usr/bin/env node
/* Turn time-tracker-2's own seed state (read from the prototype's browser
   storage after "Reset sample data") into the time tracker's sample rows:
   fixtures/time-tracker.samples.json. Run once; the output is committed. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [, , statePath] = process.argv;
if (!statePath) throw new Error("usage: time-tracker-samples.mjs <28-state.json>");
const st = JSON.parse(readFileSync(statePath, "utf8"));
const here = dirname(fileURLToPath(import.meta.url));
const ts = (date, h) => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  if (hh >= 24) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return `${d.toISOString().slice(0, 10)}T00:00:00Z`; }
  return `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
};

const person = [
  { id: "priya", name: "Priya Shah", email: "priya.shah@example.org", calendar_connected: st.connected.priya },
  { id: "sam", name: "Sam Lee", email: "sam.lee@example.org", calendar_connected: st.connected.sam },
  { id: "dana", name: "Dana Ortiz", email: "dana.ortiz@example.org", calendar_connected: st.connected.dana },
  { id: "alex", name: "Alex Kim", email: "alex.kim@example.org", calendar_connected: st.connected.alex },
  { id: "morgan", name: "Morgan Reyes", email: null, calendar_connected: false },
];
const project = st.projects.map((p) => ({ id: p.id, name: p.name, owner_id: p.owner, retired: p.retired, colour: p.colour }));
const rate = Object.entries(st.rates).flatMap(([pid, rs]) => Object.entries(rs).map(([prj, r]) => ({ id: `${pid}-${prj}`, person_id: pid, project_id: prj, hourly_rate: r })));

const invoice = st.invoices.map((i) => ({
  id: i.id, number: i.number ?? null, person_id: i.person, name: i.name, status: i.status,
  submitted_on: i.submittedAt ?? null, approved_on: i.approvedAt ?? null, paid_on: i.paidAt ?? null, return_reason: i.returnReason ?? null,
}));

const event = st.events.map((e) => ({
  id: e.id, person_id: e.person, title: e.title,
  starts_at: ts(e.date, e.allDay ? 0 : e.start), ends_at: ts(e.date, e.allDay ? 24 : e.end),
  location: e.loc || null, description: e.desc || null,
  project_id: e.project ?? null, notes: e.done ?? null, hours_override: e.hours ?? null, invoice_id: e.invoice ?? null,
  manual: !!e.manual, all_day: !!e.allDay, declined: !!e.declined,
}));
// Lines with no calendar event (entries by hand, e.g. Sam's INV-0050) become manual entries.
let n = 0;
for (const inv of st.invoices) for (const l of inv.lines ?? []) {
  if (l.eventId) continue;
  n++;
  event.push({ id: `${inv.person}-manual-${n}`, person_id: inv.person, title: l.title, starts_at: ts(l.date, 9), ends_at: ts(l.date, 9 + l.hours), location: null, description: null, project_id: l.project, notes: l.done ?? null, hours_override: null, invoice_id: inv.id, manual: true, all_day: false, declined: false });
}
// Sam's calendar, shown once he connects it (weeks of 2 and 9 November).
const samTemplate = [[0, 9, 10, "Acme weekly standup", "Zoom", "Daily status for the Acme rollout team."], [1, 10, 12, "Acme data mapping", "Room 3C", "Map source fields to the new schema."], [3, 13, 14, "Acme status review", "Room 4B", "Weekly status with the client lead."]];
for (const week of ["2026-11-02", "2026-11-09"]) samTemplate.forEach(([day, s, e, title, loc, desc], i) => {
  const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + day);
  const date = d.toISOString().slice(0, 10);
  event.push({ id: `sam-${week}-${i}`, person_id: "sam", title, starts_at: ts(date, s), ends_at: ts(date, e), location: loc, description: desc, project_id: null, notes: null, hours_override: null, invoice_id: null, manual: false, all_day: false, declined: false });
});

const expense = st.invoices.flatMap((i) => (i.expenses ?? []).map((x) => ({ id: x.id, invoice_id: i.id, spent_on: x.date, category: x.category, description: x.desc, amount: x.amount, receipt: x.receipt?.name ?? null })));

const out = { person, project, rate, invoice, event, expense };
writeFileSync(join(here, "..", "fixtures", "time-tracker.samples.json"), JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
