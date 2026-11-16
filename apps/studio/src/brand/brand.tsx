/* The brand step for the open app: read a website's brand (or a logo's),
   see three palette options on a design system, adjust one if it is not
   quite right, keep it as a brand kit and dress the app in it, or use a kit
   already in the studio's library. The Brand and style panel and the app
   room (so the App Expert) share this state, so either can act and the
   other sees it. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type BrandCapture, type BrandKit, type DesignSystemInfo, type KitTokens, type PaletteOption } from "../api";
import { useStudio } from "../studio";

export type BrandResult = { ok: true; data?: Record<string, unknown> } | { ok: false; code: string; message: string };
export type Appearance = "system" | "light" | "dark";

type Brand = {
  url: string;
  setUrl(url: string): void;
  capture: BrandCapture | null;
  /** The capture's options, with any adjusted ones in place of the originals. */
  options: PaletteOption[];
  busy: "capturing" | "options" | "adjusting" | "saving" | null;
  error: string | null;
  designSystems: DesignSystemInfo[];
  kits: BrandKit[];
  /** The kit the app wears, if any. */
  current: BrandKit | null;
  /** The default appearance the chosen option gives the app. */
  appearance: Appearance;
  setAppearance(a: Appearance): void;
  captureFromUrl(url?: string): Promise<BrandResult>;
  captureFromLogo(file: File): Promise<BrandResult>;
  setDesignSystem(name: string): Promise<BrandResult>;
  adjustOption(optionId: string, adjust: Record<string, number>): Promise<BrandResult>;
  resetOption(optionId: string): void;
  chooseOption(optionId: string, name?: string, by?: string): Promise<BrandResult>;
  applyKit(id: string, by?: string): Promise<BrandResult>;
  stopUsingKit(by?: string): Promise<BrandResult>;
  removeKit(id: string): Promise<BrandResult>;
};

const BrandContext = createContext<Brand | null>(null);
export const useBrand = () => {
  const b = useContext(BrandContext);
  if (!b) throw new Error("useBrand outside BrandProvider");
  return b;
};

const message = (e: any) => String(e?.body?.message ?? e?.message ?? e);
const code = (e: any) => String(e?.body?.code ?? "ERROR");
const fail = (e: unknown): BrandResult => ({ ok: false, code: code(e), message: message(e) });

/* What the App Expert hears back after a capture. */
const captured = (c: BrandCapture) => ({
  name: c.name, source: c.source === "logo" ? "logo file" : c.finalUrl,
  colours: c.analysis.colours.map((x) => `${x.hex} (${x.sources.map((s) => s.label).join(", ")})`),
  style: c.analysis.style.reason, designSystem: c.designSystem,
  options: c.options.map((o) => ({ id: o.id, title: o.title, buttons: o.swatches.light.structure, links: o.swatches.light.accent, review: o.findings.length })),
  notes: c.notes,
});

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const s = useStudio();
  const [url, setUrl] = useState("");
  const [capture, setCaptureState] = useState<BrandCapture | null>(null);
  const [adjusted, setAdjusted] = useState<Record<string, PaletteOption>>({});
  const [busy, setBusy] = useState<Brand["busy"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [designSystems, setDesignSystems] = useState<DesignSystemInfo[]>([]);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [appearance, setAppearance] = useState<Appearance>("system");

  const refreshKits = useCallback(async () => { setKits((await api.brandKits()).kits); }, []);
  useEffect(() => {
    api.designSystems().then((r) => setDesignSystems(r.designSystems)).catch(() => {});
    refreshKits().catch(() => {});
  }, [refreshKits]);

  const setCapture = useCallback((c: BrandCapture) => {
    setCaptureState(c);
    setAdjusted({});
    // A dark site suggests a dark app; otherwise the app follows the person's setting.
    setAppearance(c.analysis.page.appearance === "dark" ? "dark" : "system");
  }, []);

  const kitId = s.view?.definition.extensions?.["umf.ux"]?.look?.brandKit ?? null;
  const current = kits.find((k) => k.id === kitId) ?? null;
  const options = useMemo(() => (capture ? capture.options.map((o) => adjusted[o.id] ?? o) : []), [capture, adjusted]);

  const setLook = useCallback(async (args: Record<string, string>, summary: string, by: string): Promise<BrandResult> => {
    const r = await s.apply([{ op: "setLook", args }], summary, by);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    await refreshKits().catch(() => {});
    return { ok: true };
  }, [s, refreshKits]);

  const value = useMemo<Brand>(() => ({
    url, setUrl, capture, options, busy, error, designSystems, kits, current, appearance, setAppearance,
    async captureFromUrl(given) {
      const target = (given ?? url).trim();
      if (given !== undefined) setUrl(given);
      if (!target) { setError("Enter the website's address"); return { ok: false, code: "URL_REQUIRED", message: "Give the website's address" }; }
      setBusy("capturing"); setError(null);
      try {
        const c = await api.captureBrand(target);
        setCapture(c);
        return { ok: true, data: captured(c) };
      } catch (e) { setError(message(e)); return fail(e); } finally { setBusy(null); }
    },
    async captureFromLogo(file) {
      setBusy("capturing"); setError(null);
      try {
        const c = await api.brandFromLogo(file.name, await readFile(file));
        setCapture(c);
        return { ok: true, data: captured(c) };
      } catch (e) { setError(message(e)); return fail(e); } finally { setBusy(null); }
    },
    async setDesignSystem(name) {
      if (!capture) return { ok: false, code: "NO_CAPTURE", message: "Read a website's or logo's brand first" };
      setBusy("options"); setError(null);
      try {
        const c = await api.brandCapture(capture.id, name);
        // Adjustments are settings, not colours: they carry over to the new design system.
        const again: Record<string, PaletteOption> = {};
        for (const o of Object.values(adjusted)) if (o.adjusted) again[o.id] = await api.adjustBrandOption(c.id, { optionId: o.id, designSystem: name, adjust: o.adjusted });
        setCaptureState(c);
        setAdjusted(again);
        return { ok: true, data: { designSystem: c.designSystem, options: c.options.map((o) => o.id), style: c.styles.find((x) => x.name === name)?.findings.map((f) => `${f.rule}: ${f.message}`) ?? [] } };
      } catch (e) { setError(message(e)); return fail(e); } finally { setBusy(null); }
    },
    async adjustOption(optionId, adjust) {
      if (!capture) return { ok: false, code: "NO_CAPTURE", message: "Read a website's or logo's brand first" };
      const base = capture.options.find((o) => o.id === optionId);
      if (!base) return { ok: false, code: "UNKNOWN_OPTION", message: `No option ${optionId}; options: ${capture.options.map((o) => o.id).join(", ")}` };
      setBusy("adjusting"); setError(null);
      try {
        const merged = { ...(adjusted[optionId]?.adjusted ?? {}), ...adjust };
        const o = await api.adjustBrandOption(capture.id, { optionId, designSystem: capture.designSystem, adjust: merged });
        setAdjusted((a) => ({ ...a, [optionId]: o }));
        return { ok: true, data: { option: optionId, settings: o.settings, buttons: o.swatches.light.structure, links: o.swatches.light.accent, page: o.swatches.light.ground, review: o.findings.map((f) => `${f.rule}: ${f.message}`) } };
      } catch (e) { setError(message(e)); return fail(e); } finally { setBusy(null); }
    },
    resetOption(optionId) {
      setAdjusted((a) => { const { [optionId]: _, ...rest } = a; return rest; });
    },
    async chooseOption(optionId, name, by = "person") {
      if (!capture) return { ok: false, code: "NO_CAPTURE", message: "Read a website's or logo's brand first" };
      const option = options.find((o) => o.id === optionId);
      if (!option) return { ok: false, code: "UNKNOWN_OPTION", message: `No option ${optionId}; options: ${options.map((o) => o.id).join(", ")}` };
      setBusy("saving"); setError(null);
      try {
        const kit = await api.saveBrandKit({ captureId: capture.id, optionId, designSystem: capture.designSystem, name: name || capture.name, ...(option.adjusted ? { adjust: option.adjusted } : {}) });
        const r = await setLook({ brandKit: kit.id, designSystem: kit.designSystem, appearance }, `Brand: ${kit.name} (${option.title}${option.adjusted ? ", adjusted" : ""})`, by);
        if (!r.ok) { setError(r.message); return r; }
        return { ok: true, data: { kit: kit.id, name: kit.name } };
      } catch (e) { setError(message(e)); return fail(e); } finally { setBusy(null); }
    },
    async applyKit(id, by = "person") {
      const kit = kits.find((k) => k.id === id);
      if (!kit) return { ok: false, code: "UNKNOWN_KIT", message: `No brand kit ${id}; kits: ${kits.map((k) => k.id).join(", ") || "none"}` };
      return setLook({ brandKit: kit.id, designSystem: kit.designSystem }, `Brand: ${kit.name}`, by);
    },
    async stopUsingKit(by = "person") {
      return setLook({ brandKit: "" }, "Stopped using the brand kit", by);
    },
    async removeKit(id) {
      try {
        await api.removeBrandKit(id);
        await refreshKits();
        return { ok: true };
      } catch (e) { return fail(e); }
    },
  }), [url, capture, options, adjusted, busy, error, designSystems, kits, current, appearance, setLook, refreshKits, setCapture]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/* A kit's tokens for both appearances, fetched once per kit. */
const tokenCache = new Map<string, Promise<KitTokens>>();
export function useKitTokens(id: string | null | undefined) {
  const [tokens, setTokens] = useState<{ id: string; tokens: KitTokens } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    if (!tokenCache.has(id)) tokenCache.set(id, api.brandKitTokens(id).catch((e) => { tokenCache.delete(id); throw e; }));
    tokenCache.get(id)!.then((t) => { if (live) setTokens({ id, tokens: t }); }, () => {});
    return () => { live = false; };
  }, [id]);
  return id && tokens?.id === id ? tokens.tokens : null;
}
