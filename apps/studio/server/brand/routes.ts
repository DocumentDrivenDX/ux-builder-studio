/* The brand API: capture a website's brand, see the palette options for a
   design system, keep one as a brand kit, and use kits (their tokens, and a
   DTCG export). Everything runs locally; the only network request is the
   browser opening the website. */

import type express from "express";
import { type NextFunction, type Request, type Response } from "express";
import { AppError, listApps } from "../apps.js";
import { analyseCapture } from "./analyse.js";
import { capture, CaptureError } from "./capture.js";
import { toDtcg } from "./dtcg.js";
import { paletteOptions } from "./options.js";
import { captureFile, getCapture, getKit, listKits, newId, removeKit, saveCapture, saveKit, type BrandKit, type CaptureRecord } from "./store.js";
import { DESIGN_SYSTEMS, resolveBoth, type Resolved } from "./tokens.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => Promise.resolve().then(() => fn(req, res)).catch(next);
const isDesignSystem = (v: unknown): v is string => DESIGN_SYSTEMS.some((d) => d.name === v);

/* One capture at a time: each starts a browser. */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>) => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };

/* "Acme | Legal software for…" → "Acme". */
const nameOf = (rec: CaptureRecord) => (rec.siteName ?? rec.title.split(/\s+[|–—·:-]\s+/)[0] ?? rec.title).trim() || new URL(rec.finalUrl).hostname;

function captureView(rec: CaptureRecord, designSystem?: string) {
  const ds = isDesignSystem(designSystem) ? designSystem : rec.analysis.style.designSystem;
  const { options, notes } = paletteOptions(rec.analysis, ds);
  return {
    id: rec.id, url: rec.url, finalUrl: rec.finalUrl, title: rec.title, name: nameOf(rec), capturedAt: rec.capturedAt,
    screenshot: `/api/brand/captures/${rec.id}/screenshot.png`, logo: rec.hasLogo ? `/api/brand/captures/${rec.id}/logo.png` : null,
    analysis: rec.analysis, designSystem: ds, options, notes: [...rec.analysis.warnings, ...notes],
  };
}

export async function captureBrand(url: string, designSystem?: string) {
  const rec = await serial(async () => {
    const cap = await capture(url);
    const analysis = await analyseCapture(cap);
    const r: CaptureRecord = { id: newId(), url: cap.url, finalUrl: cap.finalUrl, title: cap.facts.title, siteName: cap.facts.siteName, capturedAt: new Date().toISOString(), hasLogo: !!cap.logo, analysis };
    saveCapture(r, { screenshot: cap.screenshot, logo: cap.logo });
    return r;
  });
  return captureView(rec, designSystem);
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
      if (e instanceof CaptureError) throw new AppError(e.code === "SITE_UNREACHABLE" ? 502 : e.code === "BROWSER_UNAVAILABLE" ? 503 : 400, e.code, e.message);
      throw e;
    }
  }));
  app.get("/api/brand/captures/:id", wrap((req, res) => {
    const rec = getCapture(String(req.params.id));
    if (!rec) throw new AppError(404, "CAPTURE_NOT_FOUND", `There is no capture ${req.params.id}`);
    res.json(captureView(rec, typeof req.query.designSystem === "string" ? req.query.designSystem : undefined));
  }));
  for (const name of ["screenshot.png", "logo.png"] as const) {
    app.get(`/api/brand/captures/:id/${name}`, (req, res) => {
      const file = captureFile(String(req.params.id), name);
      if (!file) return res.status(404).end();
      res.type("png").set("cache-control", "private, max-age=31536000, immutable").sendFile(file);
    });
  }

  app.get("/api/brand/kits", (_req, res) => { res.json({ kits: listKits().map(kitSummary) }); });
  app.post("/api/brand/kits", wrap((req, res) => {
    const { captureId, optionId, designSystem, name } = req.body ?? {};
    const rec = getCapture(String(captureId ?? ""));
    if (!rec) throw new AppError(404, "CAPTURE_NOT_FOUND", `There is no capture ${captureId}`);
    if (!isDesignSystem(designSystem)) throw new AppError(400, "DESIGN_SYSTEM_UNKNOWN", `Choose a design system: ${DESIGN_SYSTEMS.map((d) => d.name).join(", ")}`);
    const { options } = paletteOptions(rec.analysis, designSystem);
    const option = options.find((o) => o.id === optionId);
    if (!option) throw new AppError(404, "OPTION_NOT_FOUND", `There is no option ${optionId}; options: ${options.map((o) => o.id).join(", ")}`);
    const kit = saveKit({
      name: String(name ?? "").trim() || nameOf(rec),
      source: { url: rec.finalUrl, title: rec.title, captureId: rec.id },
      designSystem,
      option: { id: option.id, title: option.title, description: option.description, strategy: option.strategy },
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
  app.get("/api/brand/kits/:id/tokens", wrap((req, res) => { res.json(kitTokens(String(req.params.id))); }));
  app.get("/api/brand/kits/:id/tokens.json", wrap((req, res) => {
    const kit = getKit(String(req.params.id));
    if (!kit) throw new AppError(404, "BRAND_KIT_NOT_FOUND", `There is no brand kit ${req.params.id}`);
    res.set("content-disposition", `attachment; filename="${kit.id}.tokens.json"`).type("application/json").send(JSON.stringify(toDtcg(kit), null, 2));
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
