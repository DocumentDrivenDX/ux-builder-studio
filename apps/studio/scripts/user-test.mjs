#!/usr/bin/env node
/* The studio's user test: a person asks the assistant for a time tracker in
   plain language, watches it being built, then uses the app as each of its
   people, the way time-tracker-2's users do. Every step is checked and
   screenshotted; the report, screenshots, console log, final definition and
   UMF's deployment SQL land in the results folder.

   node scripts/user-test.mjs [--out <dir>] [--reuse] [--scripted]
     --reuse     use a studio already running on localhost:5173 (default: start a
                 fresh one on its own ports, on an empty data folder inside the
                 results folder, beside any studio already running)
     --scripted  the fresh studio uses the scripted builder, whatever .env says */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const studio = join(here, "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const OUT = opt("--out") ?? join(studio, "..", "..", "_scratch", "studio-user-test", stamp);
const SHOTS = join(OUT, "screenshots");
mkdirSync(SHOTS, { recursive: true });
/* Without --reuse the studio under test runs on its own ports (and its own Redis),
   so it can run beside a studio already open on the usual ones. */
const REUSE = args.includes("--reuse");
const PORTS = REUSE
  ? { web: 5173, api: 8787, realtime: 3331, worker: 8091, redis: 6379 }
  : { web: 5273, api: 8887, realtime: 3431, worker: 8191, redis: 6479 };
const WEB = `http://localhost:${PORTS.web}`;
const API = `http://127.0.0.1:${PORTS.api}`;

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const listening = (port) => new Promise((r) => { const s = createConnection({ port, host: "127.0.0.1" }); s.once("connect", () => { s.end(); r(true); }); s.once("error", () => r(false)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the studio under test ---------- */
let server = null;
if (!REUSE) {
  for (const port of [PORTS.web, PORTS.api, PORTS.realtime, PORTS.worker, PORTS.redis]) if (await listening(port)) throw new Error(`Port ${port} is in use by an earlier test run: stop it first`);
  const env = {
    ...process.env, STUDIO_DATA_DIR: join(OUT, "data"),
    STUDIO_WEB_PORT: String(PORTS.web), STUDIO_API_PORT: String(PORTS.api), STUDIO_REALTIME_PORT: String(PORTS.realtime), STUDIO_WORKER_PORT: String(PORTS.worker), REDIS_PORT: String(PORTS.redis),
    ...(args.includes("--scripted") ? { STUDIO_MODEL: "scripted" } : {}),
    STUDIO_WEB_ORIGINS: `http://localhost:${PORTS.web},http://127.0.0.1:${PORTS.web}`,
  };
  server = spawn(process.execPath, [join(here, "dev.mjs")], { cwd: studio, env, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  server.stdout.on("data", (d) => log.push(d.toString()));
  server.stderr.on("data", (d) => log.push(d.toString()));
  process.on("exit", () => { writeFileSync(join(OUT, "studio.log"), log.join("")); server?.kill("SIGTERM"); });
  const t0 = Date.now();
  while (Date.now() - t0 < 6 * 60 * 1000) {
    const ok = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok && (await listening(PORTS.web))) break;
    await wait(2000);
  }
}
const health = await fetch(`${API}/api/health`).then((r) => r.json());
const session = await fetch(`${API}/api/agent/session`).then((r) => r.json()).catch(() => null);
/* With a real model the app is the model's own design, so the checks are about
   outcomes (valid, complete, usable by every person), not time-tracker-2's numbers. */
const LIVE = !!session && session.model !== "scripted";
let finalReply = "";

/* A made-up firm's website (fixtures/sites), served here, for the brand step. */
const sites = createServer((req, res) => {
  try { res.setHeader("content-type", "text/html"); res.end(readFileSync(join(studio, "fixtures", "sites", String(req.url).split("/")[1], "index.html"))); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => sites.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${sites.address().port}/evergreen/`;
process.on("exit", () => sites.close());

/* ---------- the test ---------- */
const results = [];
const consoleLog = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleLog.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${e.message}`));
const preview = page.locator(".builder__frame");
let n = 0;
const shot = async (name, target = page) => {
  const file = join(SHOTS, `${String(++n).padStart(2, "0")}-${name}.png`);
  await target.screenshot({ path: file });
  return relative(OUT, file);
};
async function step(name, fn) {
  const t = Date.now();
  const entry = { name, ok: false, ms: 0, checks: [], screenshots: [], error: null };
  results.push(entry);
  const check = (cond, what) => { entry.checks.push({ ok: !!cond, what }); if (!cond) throw new Error(`Check failed: ${what}`); };
  try {
    await fn({ check, shot: async (s, target) => entry.screenshots.push(await shot(s, target)) });
    entry.ok = true;
  } catch (e) {
    entry.error = String(e?.message ?? e).split("\n")[0];
    entry.screenshots.push(await shot(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-failed`).catch(() => null));
  }
  entry.ms = Date.now() - t;
  console.log(`${entry.ok ? "PASS" : "FAIL"} ${name} (${Math.round(entry.ms / 1000)} s)${entry.error ? ` — ${entry.error}` : ""}`);
}
const visible = (loc) => loc.locator("visible=true").first();
/* The builder has two tabs: App configuration (the panels) and App preview (the live app and its toolbar). */
const showTab = async (name) => {
  const tab = page.getByRole("tab", { name, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") { await tab.click(); await wait(400); }
};
const panels = () => page.locator(".builder__config-section");
const panelTab = async (name) => { await showTab("App configuration"); await page.getByRole("navigation", { name: "Configuration sections" }).getByRole("link", typeof name === "string" ? { name, exact: true } : { name }).click(); };
const COMPOSER = /Message the App Expert/;
const settle = async () => { await preview.locator(".piq-skeleton").first().waitFor({ state: "detached", timeout: 90000 }).catch(() => {}); await wait(600); };
const until = async (t) => { await visible(preview.getByText(t)).waitFor({ timeout: 90000 }); await settle(); };
const signIn = async (id, expect) => { await showTab("App preview"); await page.getByLabel("Signed in as").selectOption(id); await wait(800); if (expect) await until(expect); else await settle(); };
const go = async (label, expect) => { await showTab("App preview"); await visible(preview.getByRole("link", { name: label, exact: true })).click(); await wait(600); if (expect) await until(expect); else await settle(); };
const text = async () => (await preview.innerText()).replace(/\s+/g, " ");
const gone = async (t) => { for (let i = 0; i < 60 && (await text()).includes(t); i++) await wait(500); return !(await text()).includes(t); };
const rowMenu = async (rowText, item) => {
  const row = visible(preview.getByRole("row").filter({ hasText: rowText }));
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await wait(800);
};
const toast = async () => (await page.locator(".piq-toast, [role=status]").allInnerTexts()).join(" | ");

let appId = null;

await step("Open the studio: an empty catalog", async ({ check, shot }) => {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await wait(1500);
  check(await page.getByRole("heading", { name: "Your apps" }).isVisible(), "the catalog page shows");
  check(await page.getByText("No apps yet").isVisible(), "there are no apps yet");
  check(await page.getByRole("textbox", { name: COMPOSER }).isVisible(), "the assistant's composer is ready");
  await shot("catalog-empty");
});

const REQUEST = "I need a time tracking and invoicing app: employees log time from their calendar, put it on invoices with expenses and receipts, and submit them to accounts payable, who review, return or approve them and mark them paid.";
await step("Ask the assistant for the app, in plain language", async ({ check, shot }) => {
  const composer = page.getByRole("textbox", { name: COMPOSER });
  await composer.fill(REQUEST);
  await shot("request-typed");
  await composer.press("Enter");
  const t0 = Date.now();
  let seen = 0;
  let last = "";
  let working = false;
  let idleSince = 0;
  while (Date.now() - t0 < 30 * 60 * 1000) {
    await wait(5000);
    const chat = (await page.locator(".studio-chat").innerText()).replace(/\s+/g, " ");
    const head = await page.locator(".studio-chat__head").innerText().catch(() => "");
    const tools = (chat.match(/\b(Done|Running|Failed)\b/g) ?? []).length;
    if (/\/apps\//.test(page.url()) && tools !== seen && seen < 12) { seen = tools; await shot(`building-${String(seen).padStart(2, "0")}`); }
    last = chat;
    if (!LIVE && /Your time tracker is ready|couldn't finish|stops here/i.test(chat)) break;
    if (/Working|Needs you/.test(head)) { working = true; idleSince = 0; }
    else if (working && /Ready|Problem/.test(head)) { idleSince ||= Date.now(); if (Date.now() - idleSince > 15000) break; }
  }
  await wait(3000);
  await shot("built");
  finalReply = (await page.locator(".studio-chat .piq-conversation").innerText().catch(() => last)).split("Message the App Expert")[0].slice(-3000);
  if (!LIVE) check(/Your time tracker is ready/.test(last), "the assistant says the app is ready");
  else check(working, "the assistant worked on the request and finished");
  appId = decodeURIComponent(page.url().split("/apps/")[1] ?? "");
  check(appId, "the studio opened the new app");
});

let view = null;
if (LIVE) {
  await step("UMF validated the app the model built", async ({ check, shot }) => {
    view = await fetch(`${API}/api/apps/${encodeURIComponent(appId)}`).then((r) => r.json());
    writeFileSync(join(OUT, "app.definition.json"), JSON.stringify(view.definition, null, 2));
    check(view.verdict.valid && view.verdict.renderable, "the current definition is valid UMF and renders");
    check(view.history.length >= 2 && view.history.slice(1).some((h) => h.by === "assistant"), `the assistant saved versions (${view.history.length - 1})`);
    const s = view.summary;
    check(s.roles.length >= 2, `it has roles for both sides (${s.roles.join(", ")})`);
    check(s.records.length >= 3, `it has a data model (${s.records.map((r) => r.id).join(", ")})`);
    check(s.actions.length >= 4, `people can act on it (${s.actions.length} actions)`);
    check(s.screens.length >= 3, `it has screens (${s.screens.map((x) => x.id).join(", ")})`);
    check((view.definition.extensions["umf.app"].samples?.identities ?? []).length >= 2, "it has sample people to try it as");
    await panelTab(/^Rules/);
    await wait(800);
    await shot("rules-panel");
    await panelTab("Data");
    await wait(800);
    await shot("data-panel");
  });
  for (const person of view?.definition?.extensions?.["umf.app"]?.samples?.identities ?? []) {
    await step(`Use the app as ${person.name} (${person.roles.join(", ")})`, async ({ check, shot }) => {
      await signIn(person.id);
      await settle();
      const t = await text();
      check(!/Something went wrong|can.t show this|forbidden/i.test(t), "their home screen renders");
      await shot(`as-${person.id}-home`);
      const nav = await preview.getByRole("navigation").first().getByRole("link").evaluateAll((as) => as.map((a) => a.textContent.trim()).filter(Boolean)).catch(() => []);
      check(nav.length >= 1, `they have navigation (${nav.join(", ")})`);
      for (const label of nav.slice(0, 4)) {
        await visible(preview.getByRole("navigation").first().getByRole("link", { name: label, exact: true })).click().catch(() => {});
        await settle();
        check(!/Something went wrong/i.test(await text()), `${label} renders`);
        await shot(`as-${person.id}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`);
      }
    });
  }
  await step("Open the app on its own", async ({ check, shot }) => {
    await page.goto(`${WEB}/run/${encodeURIComponent(appId)}`, { waitUntil: "networkidle" });
    await wait(3000);
    check(!/Could not open this app/.test(await page.innerText("body")), "the app runs full page");
    await shot("app-standalone");
  });
}
if (!LIVE) {
await step("UMF validated every version the assistant saved", async ({ check, shot }) => {
  view = await fetch(`${API}/api/apps/${encodeURIComponent(appId)}`).then((r) => r.json());
  check(view.verdict.valid && view.verdict.renderable, "the current definition is valid UMF and renders");
  check(view.verdict.errors.length === 0, "no validation problems");
  check(view.history.length === 7, `seven versions (created + six batches), found ${view.history.length}`);
  check(view.history.slice(1).every((h) => h.by === "assistant"), "the assistant saved every batch");
  await panelTab(/^Rules/);
  await wait(800);
  check(await page.getByText("UMF validated this version").isVisible(), "the Rules panel shows UMF's verdict");
  await shot("rules-panel");
  writeFileSync(join(OUT, "time-tracker.definition.json"), JSON.stringify(view.definition, null, 2));
});

await step("The builder shows what the app is made of", async ({ check, shot }) => {
  await panelTab("Data");
  await wait(800);
  for (const t of ["Person", "Project", "Rate", "Invoice", "Calendar event", "Expense"]) check(await panels().getByRole("heading", { name: t, exact: true }).isVisible(), `the Data panel lists ${t}`);
  await shot("data-panel");
  await panelTab("Actions");
  await wait(800);
  check((await panels().innerText()).includes("Submit to accounts payable"), "the Actions panel lists Submit to accounts payable");
  await shot("actions-panel");
  await panelTab("Database");
  await page.getByText(/tables, generated by UMF/).waitFor({ timeout: 120000 });
  const sql = await page.locator(".studio-sql").innerText();
  check(/CREATE TABLE "[^"]+"\."invoice"/.test(sql), "UMF's SQL creates the invoice table");
  check(/FOREIGN KEY/.test(sql) && /ROW LEVEL SECURITY/.test(sql), "with foreign keys and row-level security");
  writeFileSync(join(OUT, "time-tracker.deployment.sql"), sql);
  await shot("database-panel");
  await panelTab("Versions");
  await wait(800);
  await shot("versions-panel");
});

await step("Priya (employee): her week, from her calendar", async ({ check, shot }) => {
  await signIn("priya", "Unbilled this week");
  const t = await text();
  check(t.includes("Unbilled this week") && t.includes("14.25 h"), "Unbilled this week is 14.25 h, as in time-tracker-2");
  check(await visible(preview.getByRole("button", { name: /Acme data migration review/ })).isVisible(), "her calendar events are on the week grid");
  await shot("priya-time");
});

await step("Priya opens an event and saves it under a project", async ({ check, shot }) => {
  await visible(preview.getByRole("button", { name: /Acme weekly standup.*Unbilled/ })).click();
  await wait(800);
  await shot("priya-event-details");
  await page.getByRole("button", { name: "Save without invoicing", exact: true }).click();
  await wait(800);
  await page.getByLabel("Project").selectOption({ label: "Acme rollout" });
  await shot("priya-save-event-form");
  await page.getByRole("dialog").last().getByRole("button", { name: "Save without invoicing", exact: true }).click();
  await wait(2500);
  check(/saved\. It is not on an invoice yet/.test(await toast()), "the toast says it is saved, not invoiced");
  check(await visible(preview.getByRole("button", { name: /Acme weekly standup.*Saved under Acme rollout/ })).isVisible(), "the event now reads Saved under Acme rollout");
  await shot("priya-event-saved");
});

await step("Priya's invoices match time-tracker-2", async ({ check, shot }) => {
  await go("Invoices", "INV-0046 · Acme rollout · 2–8 Nov");
  const t = await text();
  for (const s of ["INV-0046 · Acme rollout · 2–8 Nov", "Acme rollout · 9–15 Nov", "Internal tools · 9–15 Nov", "INV-0047 · Internal tools · 2–8 Nov", "INV-0042 · Acme rollout · 26 Oct – 1 Nov", "INV-0038 · Acme rollout · 19–25 Oct"]) check(t.includes(s), `lists ${s}`);
  check(t.includes("Returned to you") && t.includes("$582.50") && t.includes("$240.50"), "with the prototype's totals and last change");
  check(t.includes("“The receipt for Taxi, 3 Nov is unreadable.”"), "the returned invoice shows its reason");
  await shot("priya-invoices");
});

await step("A draft can't be submitted while an expense has no receipt", async ({ check, shot }) => {
  await visible(preview.getByRole("link", { name: "Acme rollout · 9–15 Nov", exact: true })).click();
  await until("Add the receipt for Client site parking");
  let t = await text();
  check(t.includes("Add the receipt for Client site parking, 11 Nov before submitting."), "the page says which receipt is missing");
  check(t.includes("$240.50"), "the invoice total is $240.50");
  await shot("priya-draft-invoice");
  await visible(preview.getByRole("button", { name: "Submit to accounts payable", exact: true })).click();
  await wait(2500);
  t = (await text()) + (await toast());
  check(t.includes("Add the receipt for every expense before submitting."), "submitting is refused with the reason");
  await shot("priya-submit-refused");
});

await step("Priya adds an expense with its receipt", async ({ check, shot }) => {
  await visible(preview.getByRole("button", { name: "Add expense", exact: true })).click();
  await wait(800);
  const dlg = page.getByRole("dialog").last();
  await dlg.getByLabel("Amount (US dollars)").fill("12.40");
  await dlg.getByLabel("Category").selectOption("Supplies");
  await dlg.getByLabel("What it was for").fill("Markers");
  const file = join(OUT, "receipt-markers.pdf");
  writeFileSync(file, "%PDF-1.4\n% sample receipt\n");
  const upload = dlg.getByLabel("Receipt");
  if (await upload.getAttribute("type") === "file") await upload.setInputFiles(file); else await upload.fill("receipt-markers.pdf");
  await shot("priya-add-expense");
  await dlg.getByRole("button", { name: "Add expense", exact: true }).click();
  await wait(2500);
  const t = await text();
  check(t.includes("Supplies · Markers") && t.includes("$252.90"), "the expense is on the invoice and the total is $252.90");
  await shot("priya-expense-added");
});

await step("Priya submits her Internal tools draft", async ({ check, shot }) => {
  await go("Invoices", "Internal tools · 9–15 Nov");
  await visible(preview.getByRole("link", { name: "Internal tools · 9–15 Nov", exact: true })).click();
  await until("Submit to accounts payable");
  await visible(preview.getByRole("button", { name: "Submit to accounts payable", exact: true })).click();
  await wait(3000);
  check(/submitted to accounts payable/i.test(await toast()), "the toast confirms it was submitted");
  const t = await text();
  check(t.includes("My invoices") && /SUBMITTED[^]*Internal tools · 9–15 Nov|Internal tools · 9–15 Nov[^]*Submitted 12 Nov/i.test(t), "it is listed as submitted today");
  await shot("priya-submitted");
});

await step("Morgan (accounts payable) sees the review queue, never drafts", async ({ check, shot }) => {
  await signIn("morgan", "Invoices to review");
  const t = await text();
  for (const s of ["INV-0045", "INV-0047", "INV-0048", "INV-0049", "INV-0050"]) check(t.includes(s), `the queue has ${s}`);
  check(t.includes("Internal tools · 9–15 Nov") || (await preview.innerText()).includes("Priya Shah"), "Priya's new submission is in the queue");
  check(!t.includes("Acme rollout · 9–15 Nov"), "Priya's remaining draft is not visible to accounts payable");
  check(t.includes("Has lines on the employee’s own project"), "Sam's invoice is flagged for lines on his own project");
  check(/To review \(6\)/.test(t), "the nav counts six to review");
  await shot("morgan-review");
});

await step("Morgan returns an invoice, and a reason is required", async ({ check, shot }) => {
  await rowMenu("INV-0047", "Return to employee");
  const dlg = page.getByRole("dialog").last();
  await dlg.getByRole("button", { name: "Return to employee", exact: true }).click();
  await wait(1500);
  check((await dlg.innerText()).includes("Say what the employee needs to fix."), "an empty reason is refused with the prototype's message");
  await shot("morgan-return-needs-reason");
  await dlg.getByLabel("Reason").fill("Please split the sprint planning into two lines.");
  await dlg.getByRole("button", { name: "Return to employee", exact: true }).click();
  await wait(2500);
  check(/returned to Priya Shah with your reason/.test(await toast()), "the toast confirms the return");
  check(await gone("INV-0047"), "it left the queue");
  await shot("morgan-returned");
});

await step("Morgan approves an invoice and pays another", async ({ check, shot }) => {
  await rowMenu("INV-0045", "Approve");
  await wait(2000);
  check(/INV-0045 approved/.test(await toast()), "INV-0045 approved");
  await go("To pay (4)", "Invoices to pay");
  let t = await text();
  check(t.includes("INV-0045") && t.includes("INV-0041"), "To pay lists approved invoices, including the one just approved");
  await shot("morgan-to-pay");
  await rowMenu("INV-0041", "Mark paid");
  await page.getByRole("dialog").last().getByRole("button", { name: "Mark paid", exact: true }).click();
  await wait(2500);
  check(/INV-0041 marked paid/.test(await toast()), "INV-0041 marked paid today");
  check(await gone("INV-0041"), "it left To pay");
  await shot("morgan-paid");
});

await step("Dana (accounts payable) can't decide her own invoice", async ({ check, shot }) => {
  await signIn("dana-ap", "Invoices to review");
  const t = await text();
  check(t.includes("Dana Ortiz (you)") && t.includes("Your own: another reviewer decides"), "her own invoice is marked (you)");
  check(t.includes("Your own invoice is in the queue"), "the queue explains why");
  const row = visible(preview.getByRole("row").filter({ hasText: "Dana Ortiz (you)" }));
  check((await row.getByRole("button", { name: /^Actions for/ }).count()) === 0, "no Approve or Return is offered on her own invoice");
  await shot("dana-own-invoice");
});

await step("Sam (employee) connects his calendar", async ({ check, shot }) => {
  await signIn("sam", "Connect your Google Calendar");
  check((await text()).includes("Connect your Google Calendar"), "Sam is asked to connect his calendar");
  await shot("sam-connect");
  await visible(preview.getByRole("button", { name: "Connect Google Calendar", exact: true })).click();
  await wait(3000);
  check(/Calendar connected/.test(await toast()), "the toast confirms");
  check(await visible(preview.getByRole("button", { name: /Acme data mapping/ })).isVisible(), "his events appear on the week grid");
  await shot("sam-calendar");
});

await step("Change the look: another theme, and dark", async ({ check, shot }) => {
  await showTab("App preview");
  await page.getByLabel("Theme").selectOption("synaptiq");
  // The new look is a new version of the definition, which UMF validates first.
  const becomes = async (attr, v) => { for (let i = 0; i < 120; i++) { if ((await preview.locator(`[${attr}]`).first().getAttribute(attr).catch(() => null)) === v) return true; await wait(500); } return false; };
  check(await becomes("data-theme", "synaptiq"), "the preview uses the synaptiq theme");
  await shot("theme-synaptiq");
  await page.getByRole("radio", { name: "Dark" }).click();
  await wait(4000);
  check(await becomes("data-appearance", "dark"), "the preview is dark");
  await shot("theme-synaptiq-dark");
  await page.getByLabel("Theme").selectOption("plain");
  await page.getByRole("radio", { name: "Light" }).click();
  await wait(3000);
});

await step("Bring in the firm's brand from its website: three options, one chosen", async ({ check, shot }) => {
  await panelTab("Brand and style");
  await panels().getByLabel("Website", { exact: true }).fill(SITE);
  await panels().getByRole("button", { name: "Get brand" }).click();
  const options = panels().locator(".studio-brand__option");
  await options.nth(2).waitFor({ timeout: 90000 });
  check((await options.count()) === 3, "three palette options are offered");
  check(await panels().getByRole("img", { name: /^Screenshot of Evergreen Legal/ }).isVisible(), "the site's screenshot is shown");
  const found = await panels().locator(".studio-brand__colours").innerText();
  check(found.includes("#0b6e4f") && /buttons/.test(found) && /theme colour/.test(found), "the brand green is found, with where it was seen");
  check((await panels().getByLabel("Style (design system)").inputValue()) === "material", "pill-shaped buttons suggest Material");
  check((await panels().getByText("Meets the colour rules").count()) >= 1, "at least one option meets every colour rule");
  await shot("brand-options");
  await panels().getByRole("radio", { name: "Dark" }).click();
  await wait(500);
  check((await panels().locator('[data-appearance-shown="dark"]').count()) === 3, "the options can be tried in dark");
  await shot("brand-options-dark");
  await panels().getByRole("radio", { name: "Light" }).click();
  const second = options.nth(1);
  const buttons = (await second.locator(".studio-swatch").first().locator("code").innerText()).trim();
  await second.getByRole("button", { name: "Use this option" }).click();
  await panels().locator(".studio-brand__kit", { hasText: "In use" }).waitFor({ timeout: 60000 });
  check((await panels().locator(".studio-brand__kits").innerText()).includes("Evergreen Legal"), "the choice is kept as a brand kit in the library");
  await shot("brand-kit-chosen");
  await showTab("App preview");
  const app = preview.locator(".app-rt").first();
  for (let i = 0; i < 40 && !(await app.getAttribute("data-brand-kit")); i++) await wait(500);
  check((await app.getAttribute("data-brand-kit")) === "evergreen-legal", "the preview wears the kit");
  const structure = await app.evaluate((el) => getComputedStyle(el).getPropertyValue("--piq-color-structure").trim().toLowerCase());
  check(structure === buttons, `the app's primary buttons use the option's colour (${structure})`);
  await settle();
  await shot("brand-preview");
});

await step("Create a variant for the catalog", async ({ check, shot }) => {
  await page.getByRole("button", { name: "Create variant", exact: true }).click();
  const dlg = page.getByRole("dialog").last();
  await dlg.getByLabel("Name").fill("Time tracker for contractors");
  await dlg.getByLabel("What differs").fill("For outside contractors billing the firm");
  await dlg.getByRole("button", { name: "Create variant", exact: true }).click();
  await page.waitForURL(/\/apps\/.+variant/, { timeout: 120000 });
  await wait(2500);
  check((await page.getByRole("heading", { level: 1 }).first().innerText()).includes("Time tracker for contractors"), "the variant opens in the builder");
  await shot("variant");
  await page.goto(WEB, { waitUntil: "networkidle" });
  await wait(1500);
  const cards = await page.locator(".studio__main").innerText();
  check(cards.includes("Time tracker for contractors") && cards.includes("variant of"), "the catalog lists it as a variant");
  await shot("catalog-with-variant");
});

await step("Open the app on its own, as its people use it", async ({ check, shot }) => {
  await page.goto(`${WEB}/run/${encodeURIComponent(appId)}`, { waitUntil: "networkidle" });
  await wait(3000);
  check((await page.innerText("body")).includes("Unbilled this week"), "the app runs full page");
  check((await page.locator(".app-rt").first().getAttribute("data-brand-kit")) === "evergreen-legal", "in its brand kit");
  await shot("app-standalone");
  await page.setViewportSize({ width: 390, height: 844 });
  await wait(2500);
  await shot("app-standalone-phone");
});

}
await browser.close();
const errors = consoleLog.filter((l) => l.startsWith("[error]") || l.startsWith("[pageerror]"));
writeFileSync(join(OUT, "console.txt"), consoleLog.join("\n"));
const passed = results.filter((r) => r.ok).length;
const summary = { date: new Date().toISOString(), studio: health, model: session?.model ?? null, steps: results.length, passed, failed: results.length - passed, consoleErrors: errors.length, appId, results };
writeFileSync(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
const md = [
  `# UX Builder Studio: user test (time tracker)`,
  ``,
  `**${passed} of ${results.length} steps passed.** Browser console errors: ${errors.length}${errors.length && errors.every((e) => /status of 422/.test(e)) ? " (each is an action the test expects to be refused: the studio answers a refused action with HTTP 422, which the browser logs)" : ""}.`,
  ``,
  `- Studio: UMF ${health.umf}; database ${health.database}`,
  `- Assistant model: ${session?.model ?? "none"}${session?.model === "scripted" ? " (no API key configured: the scripted builder replays the recorded build through the real agent, OUI and UMF pipeline)" : ""}`,
  `- Request: “${REQUEST}”`,
  ...(LIVE ? [``, `### The assistant's reply`, ``, ...finalReply.split("\n").map((l) => `> ${l}`)] : []),
  `- App: ${appId} (definition: time-tracker.definition.json; UMF deployment SQL: time-tracker.deployment.sql)`,
  ``,
  ...results.flatMap((r) => [
    `## ${r.ok ? "✅" : "❌"} ${r.name} (${Math.round(r.ms / 1000)} s)`,
    ...(r.error ? [``, `**Failed:** ${r.error}`] : []),
    ``,
    ...r.checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.what}`),
    ``,
    ...r.screenshots.filter(Boolean).map((s) => `![${r.name}](${s})`),
    ``,
  ]),
  ...(errors.length ? [`## Console errors`, "", ...errors.slice(0, 30).map((e) => `- ${e}`), ""] : []),
].join("\n");
writeFileSync(join(OUT, "report.md"), md);
console.log(`\n${passed}/${results.length} passed · console errors ${errors.length}\nResults: ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
