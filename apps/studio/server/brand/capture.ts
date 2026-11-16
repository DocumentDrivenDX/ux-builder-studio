/* Capturing a website for its brand, on this machine: a headless Chromium
   (Playwright) opens the page at desktop size, accepts a cookie banner if one
   is in the way, takes a screenshot of the first screen, reads what the CSS
   says (page-facts.ts) and screenshots the logo on its own. Nothing is sent
   to any other service. */

import { chromium } from "playwright";
import { PAGE_FACTS, type PageFacts } from "./page-facts.js";

export type Capture = {
  url: string;
  finalUrl: string;
  facts: PageFacts;
  manifest: { themeColor: string | null; backgroundColor: string | null } | null;
  screenshot: Buffer;
  logo: Buffer | null;
  warnings: string[];
};

export class CaptureError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const VIEWPORT = { width: 1366, height: 900 };

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

export async function capture(input: string, { timeoutMs = 30000 } = {}): Promise<Capture> {
  const url = normaliseUrl(input);
  const warnings: string[] = [];
  const browser = await chromium.launch({ headless: true }).catch((e: Error) => {
    throw new CaptureError("BROWSER_UNAVAILABLE", `The studio could not start its browser (${e.message.split("\n")[0]}). Run npm run setup once.`);
  });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "light", locale: "en-US" });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    } catch (e: any) {
      throw new CaptureError("SITE_UNREACHABLE", `Could not open ${url}: ${String(e?.message ?? e).split("\n")[0]}`);
    }
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => warnings.push("The page kept loading; it was read after 6 seconds."));
    // A consent banner covers the page and would colour the screenshot.
    const consent = page.getByRole("button", { name: ACCEPT }).first();
    if (await consent.isVisible().catch(() => false)) await consent.click({ timeout: 2000 }).catch(() => {});
    await page.evaluate("document.fonts && document.fonts.ready").catch(() => {});
    await page.waitForTimeout(500);

    const facts = (await page.evaluate(PAGE_FACTS)) as PageFacts;
    const screenshot = await page.screenshot({ type: "png" });
    let logo: Buffer | null = null;
    if (facts.logo.found) logo = await page.locator("[data-studio-logo]").first().screenshot({ omitBackground: true, timeout: 5000 }).catch(() => null);
    if (!logo) warnings.push("No logo was found in the page's header; colours come from the page and its CSS.");

    let manifest: Capture["manifest"] = null;
    if (facts.manifestHref) {
      const res = await page.request.get(facts.manifestHref, { timeout: 5000 }).catch(() => null);
      const m = res?.ok() ? await res.json().catch(() => null) : null;
      if (m) manifest = { themeColor: hexOf(m.theme_color), backgroundColor: hexOf(m.background_color) };
    }
    return { url, finalUrl: page.url(), facts, manifest, screenshot, logo, warnings };
  } finally {
    await browser.close().catch(() => {});
  }
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
