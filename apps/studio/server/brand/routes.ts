/* The brand API: capture a website's brand, see the palette options for a
   design system, keep one as a brand kit, and use kits (their tokens, and a
   DTCG export). Everything runs locally; the only network request is the
   browser opening the website. */

import { readFileSync } from "node:fs";
import type express from "express";
import { type NextFunction, type Request, type Response } from "express";
import { AppError, listApps } from "../apps.js";
import { analyseCapture, analyseLogo } from "./analyse.js";
import { capture, CaptureError, rasteriseSvg } from "./capture.js";
import { toDtcg } from "./dtcg.js";
import { adjustOption, adjustRanges, paletteOptions, type Adjustment } from "./options.js";
import { captureFile, getCapture, getKit, listKits, newId, removeKit, saveCapture, saveKit, type BrandKit, type CaptureRecord } from "./store.js";
import { DESIGN_SYSTEMS, resolveBoth, type Resolved } from "./tokens.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => Promise.resolve().then(() => fn(req, res)).catch(next);
const isDesignSystem = (v: unknown): v is string => DESIGN_SYSTEMS.some((d) => d.name === v);

/* One capture at a time: each starts a browser. */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>) => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };

/* "Acme | Legal software for…" → "Acme"; a logo file is named after the file. */
const nameOf = (rec: CaptureRecord) => rec.source === "logo"
  ? rec.title
  : (rec.siteName ?? rec.title.split(/\s+[|–—·:-]\s+/)[0] ?? rec.title).trim() || new URL(rec.finalUrl).hostname;

function captureView(rec: CaptureRecord, designSystem?: string) {
  const ds = isDesignSystem(designSystem) ? designSystem : rec.analysis.style.designSystem;
  const { options, notes, styles } = paletteOptions(rec.analysis, ds);
  const logoFile = rec.logoType === "svg" ? "logo.svg" : "logo.png";
  return {
    id: rec.id, source: rec.source ?? "website", url: rec.url, finalUrl: rec.finalUrl, title: rec.title, name: nameOf(rec), capturedAt: rec.capturedAt,
    screenshot: rec.source === "logo" ? null : `/api/brand/captures/${rec.id}/screenshot.png`, screenshotHeight: rec.source === "logo" ? null : rec.screenshotHeight ?? 900, logo: rec.hasLogo ? `/api/brand/captures/${rec.id}/${logoFile}` : null,
    analysis: rec.analysis, designSystem: ds, options, styles, adjustable: adjustRanges(), notes: [...rec.analysis.warnings, ...notes],
  };
}

export async function captureBrand(url: string, designSystem?: string) {
  const rec = await serial(async () => {
    const cap = await capture(url);
    const analysis = await analyseCapture(cap);
    const r: CaptureRecord = { id: newId(), source: "website", url: cap.url, finalUrl: cap.finalUrl, title: cap.facts.title, siteName: cap.facts.siteName, capturedAt: new Date().toISOString(), screenshotHeight: cap.screenshotHeight, hasLogo: !!cap.logo, analysis };
    saveCapture(r, { screenshot: cap.screenshot, logo: cap.logo });
    return r;
  });
  return captureView(rec, designSystem);
}

/* A brand from a logo file the person gives (SVG or PNG, at most 2 MB). */
export async function logoBrand(filename: string, bytes: Buffer, designSystem?: string) {
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isSvg = !isPng && /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString("utf8"));
  if (!isPng && !isSvg) throw new AppError(400, "LOGO_UNSUPPORTED", "The logo must be an SVG or PNG file");
  if (bytes.length > 2 * 1024 * 1024) throw new AppError(413, "LOGO_TOO_LARGE", "The logo is larger than 2 MB");
  const measured = isSvg ? await serial(() => rasteriseSvg(bytes)).catch(() => bytes) : bytes;
  const analysis = await analyseLogo(new Uint8Array(measured));
  const title = filename.replace(/\.(svg|png)$/i, "").replace(/[-_]+/g, " ").replace(/\blogo\b/i, "").trim() || "Brand";
  const r: CaptureRecord = { id: newId(), source: "logo", url: `file:${filename}`, finalUrl: `file:${filename}`, title, siteName: null, capturedAt: new Date().toISOString(), hasLogo: true, logoType: isSvg ? "svg" : "png", analysis };
  saveCapture(r, { screenshot: null, logo: bytes });
  return captureView(r, designSystem);
}

const kitSummary = (k: BrandKit) => {
  const light = (k.brand.appearances as any).light?.color ?? {};
  return {
    id: k.id, name: k.name, createdAt: k.createdAt, source: k.source, designSystem: k.designSystem, option: k.option,
    swatches: { structure: light.structure?.$value, accent: light.accent?.$value, ground: light.ground?.$value, surface: light.surface?.$value },
    colours: k.colours, findings: k.findings,
    usedBy: listApps().filter((a: any) => a.brandKit === k.id).map((a: any) => ({ id: a.id, name: a.name })),
  };
};

/* Where a kit came from and what was chosen from it: the capture (read-only),
   the option, design system and engine settings. The capture is the record
   of the brand's origin; it is kept even when its kit is removed. */
export function kitSources(kit: BrandKit) {
  const rec = kit.source ? getCapture(kit.source.captureId) : null;
  let settings = kit.option.settings ?? null;
  let notes: string[] = [];
  if (rec) {
    try {
      const { options, notes: n } = paletteOptions(rec.analysis, kit.designSystem);
      notes = [...rec.analysis.warnings, ...n];
      if (!settings) settings = kit.option.adjusted && Object.keys(kit.option.adjusted).length
        ? adjustOption(rec.analysis, kit.designSystem, kit.option.id, kit.option.adjusted as Adjustment).settings
        : options.find((o) => o.id === kit.option.id)?.settings ?? null;
    } catch { /* the settings can't be worked out again; the kit's colours are still its own */ }
  }
  const logoFile = rec?.logoType === "svg" ? "logo.svg" : "logo.png";
  const screenshot = rec && rec.source !== "logo" && captureFile(rec.id, "screenshot.png") ? `/api/brand/captures/${rec.id}/screenshot.png` : null;
  const logo = rec?.hasLogo && captureFile(rec.id, logoFile) ? `/api/brand/captures/${rec.id}/${logoFile}` : null;
  const missing = !kit.source ? "This kit has no recorded source."
    : !rec ? `The capture this kit was made from (${kit.source.captureId}) is no longer in the studio's data folder, so its screenshot and findings can't be shown. The kit's own colours are unaffected.`
    : rec.source !== "logo" && !screenshot ? "The capture's screenshot file is missing from the studio's data folder." : null;
  return {
    kit: kitSummary(kit),
    chosen: { option: { id: kit.option.id, title: kit.option.title, description: kit.option.description, strategy: kit.option.strategy }, designSystem: kit.designSystem, settings, adjusted: kit.option.adjusted ?? null, findings: kit.findings },
    capture: rec ? {
      id: rec.id, source: rec.source ?? "website", url: rec.url, finalUrl: rec.finalUrl, title: rec.title, name: nameOf(rec), capturedAt: rec.capturedAt,
      screenshot, screenshotHeight: screenshot ? rec.screenshotHeight ?? 900 : null, logo,
      colours: rec.analysis.colours, fonts: rec.analysis.fonts, style: rec.analysis.style, notes,
    } : null,
    missing,
  };
}

/* A kit's provenance, as it travels in its DTCG file. */
export function kitProvenance(kit: BrandKit) {
  const s = kitSources(kit);
  return {
    source: s.capture ? (s.capture.source === "logo" ? { logoFile: s.capture.url.replace(/^file:/, "") } : { url: s.capture.url, finalUrl: s.capture.finalUrl }) : kit.source ? { url: kit.source.url } : null,
    title: s.capture?.title ?? kit.source?.title ?? null,
    capturedAt: s.capture?.capturedAt ?? null,
    captureId: kit.source?.captureId ?? null,
    option: { id: kit.option.id, strategy: kit.option.strategy, title: kit.option.title },
    designSystem: kit.designSystem,
    settings: s.chosen.settings,
    adjusted: kit.option.adjusted ?? null,
    kit: { id: kit.id, createdAt: kit.createdAt },
  };
}

const tokenCache = new Map<string, Resolved>();
export function kitTokens(id: string) {
  const kit = getKit(id);
  if (!kit) throw new AppError(404, "BRAND_KIT_NOT_FOUND", `There is no brand kit ${id}`);
  const key = `${kit.id}:${kit.createdAt}`;
  if (!tokenCache.has(key)) tokenCache.set(key, resolveBoth(kit.brand, kit.designSystem));
  return tokenCache.get(key)!;
}

export function mountBrand(app: express.Express) {
  app.get("/api/brand/design-systems", (_req, res) => { res.json({ designSystems: DESIGN_SYSTEMS }); });

  app.post("/api/brand/captures", wrap(async (req, res) => {
    const { url, designSystem } = req.body ?? {};
    try {
      res.status(201).json(await captureBrand(String(url ?? ""), designSystem));
    } catch (e) {
      if (e instanceof CaptureError) throw new AppError(e.code === "SITE_UNREACHABLE" || e.code === "SITE_BLOCKED" ? 502 : e.code === "BROWSER_UNAVAILABLE" ? 503 : 400, e.code, e.message);
      throw e;
    }
  }));
  app.get("/api/brand/captures/:id", wrap((req, res) => {
    const rec = getCapture(String(req.params.id));
    if (!rec) throw new AppError(404, "CAPTURE_NOT_FOUND", `There is no capture ${req.params.id}`);
    res.json(captureView(rec, typeof req.query.designSystem === "string" ? req.query.designSystem : undefined));
  }));
  for (const name of ["screenshot.png", "logo.png", "logo.svg"] as const) {
    app.get(`/api/brand/captures/:id/${name}`, (req, res) => {
      const file = captureFile(String(req.params.id), name);
      if (!file) return res.status(404).end();
      // A person's SVG is shown as an image only: nothing in it may run, even opened directly.
      if (name.endsWith(".svg")) res.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      // Sent from memory, not sendFile: the data folder (.data) is a dot-folder, which sendFile refuses.
      res.type(name.endsWith(".svg") ? "image/svg+xml" : "png").set("cache-control", "private, max-age=31536000, immutable").send(readFileSync(file));
    });
  }
  app.post("/api/brand/captures/logo", wrap(async (req, res) => {
    const { filename, data, designSystem } = req.body ?? {};
    if (typeof data !== "string" || !data) throw new AppError(400, "LOGO_REQUIRED", "Give the logo file");
    res.status(201).json(await logoBrand(String(filename ?? "logo"), Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"), designSystem));
  }));
  app.post("/api/brand/captures/:id/adjust", wrap((req, res) => {
    const rec = getCapture(String(req.params.id));
    if (!rec) throw new AppError(404, "CAPTURE_NOT_FOUND", `There is no capture ${req.params.id}`);
    const { optionId, designSystem, adjust } = req.body ?? {};
    if (!isDesignSystem(designSystem)) throw new AppError(400, "DESIGN_SYSTEM_UNKNOWN", `Choose a design system: ${DESIGN_SYSTEMS.map((d) => d.name).join(", ")}`);
    try {
      res.json(adjustOption(rec.analysis, designSystem, String(optionId ?? ""), (adjust ?? {}) as Adjustment));
    } catch (e: any) {
      throw new AppError(422, "ADJUST_FAILED", String(e?.message ?? e));
    }
  }));

  app.get("/api/brand/kits", (_req, res) => { res.json({ kits: listKits().map(kitSummary) }); });
  app.post("/api/brand/kits", wrap((req, res) => {
    const { captureId, optionId, designSystem, name, adjust } = req.body ?? {};
    const rec = getCapture(String(captureId ?? ""));
    if (!rec) throw new AppError(404, "CAPTURE_NOT_FOUND", `There is no capture ${captureId}`);
    if (!isDesignSystem(designSystem)) throw new AppError(400, "DESIGN_SYSTEM_UNKNOWN", `Choose a design system: ${DESIGN_SYSTEMS.map((d) => d.name).join(", ")}`);
    const { options } = paletteOptions(rec.analysis, designSystem);
    let option = options.find((o) => o.id === optionId);
    if (!option) throw new AppError(404, "OPTION_NOT_FOUND", `There is no option ${optionId}; options: ${options.map((o) => o.id).join(", ")}`);
    if (adjust && Object.keys(adjust).length) {
      try { option = adjustOption(rec.analysis, designSystem, option.id, adjust as Adjustment); }
      catch (e: any) { throw new AppError(422, "ADJUST_FAILED", String(e?.message ?? e)); }
    }
    const kit = saveKit({
      name: String(name ?? "").trim() || nameOf(rec),
      source: { url: rec.finalUrl, title: rec.title, captureId: rec.id },
      designSystem,
      option: { id: option.id, title: option.title, description: option.description, strategy: option.strategy, settings: option.settings, ...(option.adjusted ? { adjusted: option.adjusted } : {}) },
      brand: option.brand,
      colours: rec.analysis.colours.map((c) => ({ hex: c.hex, sources: c.sources.map((s) => s.label) })),
      findings: option.findings,
    });
    res.status(201).json(kitSummary(kit));
  }));
  app.get("/api/brand/kits/:id", wrap((req, res) => {
    const kit = getKit(String(req.params.id));
    if (!kit) throw new AppError(404, "BRAND_KIT_NOT_FOUND", `There is no brand kit ${req.params.id}`);
    res.json(kitSummary(kit));
  }));
  app.get("/api/brand/kits/:id/sources", wrap((req, res) => {
    const kit = getKit(String(req.params.id));
    if (!kit) throw new AppError(404, "BRAND_KIT_NOT_FOUND", `There is no brand kit ${req.params.id}`);
    res.json(kitSources(kit));
  }));
  app.get("/api/brand/kits/:id/tokens", wrap((req, res) => { res.json(kitTokens(String(req.params.id))); }));
  app.get("/api/brand/kits/:id/tokens.json", wrap((req, res) => {
    const kit = getKit(String(req.params.id));
    if (!kit) throw new AppError(404, "BRAND_KIT_NOT_FOUND", `There is no brand kit ${req.params.id}`);
    res.set("content-disposition", `attachment; filename="${kit.id}.tokens.json"`).type("application/json").send(JSON.stringify(toDtcg(kit, kitProvenance(kit)), null, 2));
  }));
  app.delete("/api/brand/kits/:id", wrap((req, res) => {
    const kit = getKit(String(req.params.id));
    if (!kit) throw new AppError(404, "BRAND_KIT_NOT_FOUND", `There is no brand kit ${req.params.id}`);
    const usedBy = kitSummary(kit).usedBy;
    if (usedBy.length) throw new AppError(409, "BRAND_KIT_IN_USE", `${kit.name} is used by ${usedBy.map((a) => a.name).join(", ")}; choose another look for ${usedBy.length === 1 ? "it" : "them"} first`);
    removeKit(kit.id);
    res.json({ ok: true });
  }));
}
