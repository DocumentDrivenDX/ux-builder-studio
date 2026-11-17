/* Capturing a website for its brand, on this machine: a headless Chromium
   (Playwright) opens the page at desktop size, accepts a cookie banner if one
   is in the way, reads what the CSS says (page-facts.ts), screenshots the
   first screen (what the colours are measured on) and the logo on its own,
   then scrolls the page to load what loads lazily and keeps a longer
   screenshot of it, at most SHOT_MAX px tall, as the record of what was
   seen. Nothing is sent to any other service. */

import { chromium } from "playwright";
import { PAGE_FACTS, type PageFacts } from "./page-facts.js";

export type Capture = {
  url: string;
  finalUrl: string;
  facts: PageFacts;
  manifest: { themeColor: string | null; backgroundColor: string | null } | null;
  /** The page from the top, at most SHOT_MAX px tall: the record of what was seen. */
  screenshot: Buffer;
  screenshotHeight: number;
  /** The first screen only (VIEWPORT): what the colours are measured on, so results don't depend on how long the page is. */
  firstScreen: Buffer;
  logo: Buffer | null;
  warnings: string[];
};

export class CaptureError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const VIEWPORT = { width: 1366, height: 900 };
export const SHOT_MAX = 2000;

/* A website address people type: example.com, www.example.com/about or a full URL. */
export function normaliseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new CaptureError("URL_REQUIRED", "Give the website's address");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { throw new CaptureError("URL_INVALID", `${raw} is not a website address`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new CaptureError("URL_INVALID", "Only http and https addresses can be read");
  return url.toString();
}

const ACCEPT = /^(accept|accept all|accept all cookies|allow all|allow all cookies|agree|i agree|got it|ok|okay)$/i;
const hexOf = (v: unknown) => (typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : null);

/* Many sites turn away a browser that says it is headless (Akamai, Cloudflare
   and the like answer "Access Denied" or a challenge page). So the studio
   uses Chromium's full headless mode and presents itself as the Chrome it
   is, minus the "Headless" in its user agent; if the site still refuses,
   it tries the Google Chrome installed on this machine. A page that is
   still a refusal is reported as one, never analysed as the brand. */
const BLOCKED_TITLE = /^(access denied|forbidden|attention required|just a moment|request blocked|pardon our interruption|are you a (human|robot)|security check|403 forbidden|blocked|robot or human\??|captcha)/i;
const BLOCKED_TEXT = /(access denied|you don't have permission to access|request (was )?blocked|verify (that )?you are (a )?human|checking your browser|enable javascript and cookies to continue|unusual traffic|bot detection|reference #[0-9a-f.]+)/i;
const ATTEMPTS: Array<{ name: string; launch: Parameters<typeof chromium.launch>[0] }> = [
  { name: "Chromium", launch: { headless: true, channel: "chromium", args: ["--disable-blink-features=AutomationControlled"] } },
  { name: "Google Chrome", launch: { headless: true, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] } },
];

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>;

/* Why a loaded page is a refusal, not the site: its status, title or (for a short page) its text. */
async function refusal(page: Page, status: number | undefined) {
  const title = (await page.title().catch(() => "")).trim();
  const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 2000) : ''").catch(() => ""));
  if (status && status >= 400) return `it answered ${status}${title ? ` (“${title}”)` : ""}`;
  if (BLOCKED_TITLE.test(title)) return `it showed “${title}”`;
  if (text.length < 600 && BLOCKED_TEXT.test(text)) return `it showed a page that blocks automated browsers`;
  return null;
}

export async function capture(input: string, { timeoutMs = 30000 } = {}): Promise<Capture> {
  const url = normaliseUrl(input);
  const refusals: string[] = [];
  let started = 0, lastLaunchError = "";
  for (const attempt of ATTEMPTS) {
    const browser = await chromium.launch(attempt.launch).catch((e: Error) => { lastLaunchError = e.message.split("\n")[0]; return null; });
    if (!browser) continue;
    started++;
    try {
      const result = await readPage(browser, url, timeoutMs);
      if ("refused" in result) { refusals.push(`${attempt.name}: ${result.refused}`); continue; }
      return result;
    } finally {
      await browser.close().catch(() => {});
    }
  }
  if (!started) throw new CaptureError("BROWSER_UNAVAILABLE", `The studio could not start its browser (${lastLaunchError}). Run npm run setup once.`);
  const host = new URL(url).hostname;
  throw new CaptureError("SITE_BLOCKED", `${host} turned the studio's browser away (${refusals.join("; ")}). Some sites block automated browsers. Try another page of the site, or start from the organisation's logo file instead.`);
}

async function readPage(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string, timeoutMs: number): Promise<Capture | { refused: string }> {
  const warnings: string[] = [];
  // The browser's own user agent, without "Headless": the same Chrome, as a person's would say.
  const probe = await browser.newPage();
  const userAgent = String(await probe.evaluate("navigator.userAgent")).replace(/HeadlessChrome/g, "Chrome");
  await probe.close();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "light", locale: "en-US", userAgent, extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" } });
  const page = await context.newPage();
  let status: number | undefined;
  try {
    status = (await page.goto(url, { waitUntil: "load", timeout: timeoutMs }))?.status();
  } catch (e: any) {
    throw new CaptureError("SITE_UNREACHABLE", `Could not open ${url}: ${String(e?.message ?? e).split("\n")[0]}`);
  }
  // A challenge page ("Just a moment…") often clears itself in a few seconds.
  for (let i = 0; i < 8 && /^(just a moment|checking your browser|please wait)/i.test(await page.title().catch(() => "")); i++) {
    await page.waitForTimeout(1000);
    status = 200;
  }
  const refused = await refusal(page, status);
  if (refused) return { refused };
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => warnings.push("The page kept loading; it was read after 6 seconds."));
  // A consent banner covers the page and would colour the screenshot.
  const consent = page.getByRole("button", { name: ACCEPT }).first();
  if (await consent.isVisible().catch(() => false)) await consent.click({ timeout: 2000 }).catch(() => {});
  await page.evaluate("document.fonts && document.fonts.ready").catch(() => {});
  await page.waitForTimeout(500);

  const facts = (await page.evaluate(PAGE_FACTS)) as PageFacts;
  const firstScreen = await page.screenshot({ type: "png" });
  let logo: Buffer | null = null;
  if (facts.logo.found) logo = await page.locator("[data-studio-logo]").first().screenshot({ omitBackground: true, timeout: 5000 }).catch(() => null);
  if (!logo) warnings.push("No logo was found in the page's header; colours come from the page and its CSS.");

  // Down the page a screen at a time, so lazily loaded images and sections appear, then back to the top for the longer screenshot.
  const pageHeight = Number(await page.evaluate("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)").catch(() => VIEWPORT.height)) || VIEWPORT.height;
  for (let y = VIEWPORT.height / 2; y < Math.min(pageHeight, SHOT_MAX); y += VIEWPORT.height / 2) {
    await page.evaluate(`window.scrollTo(0, ${y})`).catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.evaluate("window.scrollTo(0, 0)").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const tall = Number(await page.evaluate("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)").catch(() => pageHeight)) || pageHeight;
  const screenshotHeight = Math.max(1, Math.min(Math.round(tall), SHOT_MAX));
  const screenshot = await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: VIEWPORT.width, height: screenshotHeight } })
    .catch(() => null) ?? firstScreen;
  const shotHeight = screenshot === firstScreen ? Math.min(VIEWPORT.height, screenshotHeight) : screenshotHeight;

  let manifest: Capture["manifest"] = null;
  if (facts.manifestHref) {
    const res = await page.request.get(facts.manifestHref, { timeout: 5000 }).catch(() => null);
    const m = res?.ok() ? await res.json().catch(() => null) : null;
    if (m) manifest = { themeColor: hexOf(m.theme_color), backgroundColor: hexOf(m.background_color) };
  }
  return { url, finalUrl: page.url(), facts, manifest, screenshot, screenshotHeight: shotHeight, firstScreen, logo, warnings };
}

/* An SVG logo drawn in the browser (as an image, so nothing in it runs) and
   returned as a PNG, so its colours are measured by the area they cover, as
   ux-builder's theme builder does, not by how often the markup names them. */
export async function rasteriseSvg(svg: Buffer, size = 480): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true }).catch((e: Error) => {
    throw new CaptureError("BROWSER_UNAVAILABLE", `The studio could not start its browser (${e.message.split("\n")[0]}). Run npm run setup once.`);
  });
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img id="logo" style="max-width:${size}px;max-height:${size}px;width:${size}px;height:auto" src="data:image/svg+xml;base64,${svg.toString("base64")}"></body></html>`);
    const img = page.locator("#logo");
    await img.evaluate((el: any) => (el.complete ? null : new Promise((r) => { el.onload = r; el.onerror = r; })));
    return await img.screenshot({ omitBackground: true, timeout: 5000 });
  } finally {
    await browser.close().catch(() => {});
  }
}
