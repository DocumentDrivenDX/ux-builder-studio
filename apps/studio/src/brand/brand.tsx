/* The brand step for the open app: read a website's brand (or a logo's),
   see three palette options on a design system, adjust one if it is not
   quite right, keep it as a brand kit and dress the app in it, or use a kit
   already in the studio's library. The Brand and style panel and the app
   room (so the App Expert) share this state, so either can act and the
   other sees it.

   Adjusting is live: moving a slider re-makes that option with the
   engine (at most every LIVE_MS while dragging, the last position always
   applied), and a reply that a later move has overtaken is dropped. A
   setting the engine cannot fit to the contrast rules leaves the last good
   option showing, with the reason beside the sliders. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type BrandCapture, type BrandKit, type DesignSystemInfo, type KitTokens, type PaletteOption } from "../api";
import { useStudio } from "../studio";

export type BrandResult = { ok: true; data?: Record<string, unknown> } | { ok: false; code: string; message: string };
export type Appearance = "system" | "light" | "dark";
/** One option's sliders while a person moves them. */
export type LiveAdjust = { values: Record<string, number>; updating: boolean; problem: string | null };

const LIVE_MS = 150;
/* The settings that differ from the option as offered. */
const diffOf = (values: Record<string, number>, base: PaletteOption) =>
  Object.fromEntries(Object.entries(values).filter(([k, v]) => Math.abs(v - (base.settings[k] ?? v)) > 1e-9));

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
  /** The sliders of each option a person is adjusting, by option id. */
  live: Record<string, LiveAdjust>;
  /** Moves one slider: the option is made again with it, live. */
  setSetting(optionId: string, name: string, value: number): void;
  /** Puts an option back as it was offered: its original settings and colours. */
  resetOption(optionId: string): BrandResult;
  /** Whether an option differs from the one offered (adjusted, or a slider moved). */
  isChanged(optionId: string): boolean;
  chooseOption(optionId: string, name?: string, by?: string): Promise<BrandResult>;
  applyKit(id: string, by?: string): Promise<BrandResult>;
  stopUsingKit(by?: string): Promise<BrandResult>;
  removeKit(id: string): Promise<BrandResult>;
  /** The kit whose sources (the capture behind it) are open, if any. */
  sourcesOf: string | null;
  showSources(kitId: string | null): BrandResult;
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
  const [live, setLive] = useState<Record<string, LiveAdjust>>({});
  const [sourcesOf, setSourcesOf] = useState<string | null>(null);
  // For the live adjust timers, which outlive a render: the latest capture, the sliders' values, and which reply is current.
  const captureRef = useRef<BrandCapture | null>(null);
  const drafts = useRef<Record<string, Record<string, number>>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(new Map<string, number>());
  const epoch = useRef(0);
  captureRef.current = capture;

  /* Forget every live adjustment in progress: a new capture or design system makes them stale. */
  const settle = useCallback((optionId?: string) => {
    const ids = optionId ? [optionId] : [...new Set([...timers.current.keys(), ...Object.keys(drafts.current)])];
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      seq.current.set(id, (seq.current.get(id) ?? 0) + 1);
      delete drafts.current[id];
    }
    if (!optionId) epoch.current++;
    setLive((l) => { if (!optionId) return {}; const { [optionId]: _, ...rest } = l; return rest; });
  }, []);

  const refreshKits = useCallback(async () => { setKits((await api.brandKits()).kits); }, []);
  useEffect(() => {
    api.designSystems().then((r) => setDesignSystems(r.designSystems)).catch(() => {});
    refreshKits().catch(() => {});
  }, [refreshKits]);

  const setCapture = useCallback((c: BrandCapture) => {
    settle();
    setCaptureState(c);
    setAdjusted({});
    // A dark site suggests a dark app; otherwise the app follows the person's setting.
    setAppearance(c.analysis.page.appearance === "dark" ? "dark" : "system");
  }, [settle]);

  /* Makes one option again from its sliders' current values: a change from the option as offered, or the original when there is none. */
  const remake = useCallback(async (optionId: string) => {
    timers.current.delete(optionId);
    const c = captureRef.current, values = drafts.current[optionId];
    const base = c?.options.find((o) => o.id === optionId);
    if (!c || !base || !values) return;
    const n = (seq.current.get(optionId) ?? 0) + 1, at = epoch.current;
    seq.current.set(optionId, n);
    const current = () => seq.current.get(optionId) === n && epoch.current === at;
    const diff = diffOf(values, base);
    if (!Object.keys(diff).length) {
      setAdjusted((a) => { const { [optionId]: _, ...rest } = a; return rest; });
      setLive((l) => (l[optionId] ? { ...l, [optionId]: { ...l[optionId], updating: false, problem: null } } : l));
      return;
    }
    try {
      const o = await api.adjustBrandOption(c.id, { optionId, designSystem: c.designSystem, adjust: diff });
      if (!current()) return;
      setAdjusted((a) => ({ ...a, [optionId]: o }));
      setLive((l) => (l[optionId] ? { ...l, [optionId]: { ...l[optionId], updating: timers.current.has(optionId), problem: null } } : l));
    } catch (e) {
      if (!current()) return;
      setLive((l) => (l[optionId] ? { ...l, [optionId]: { ...l[optionId], updating: timers.current.has(optionId), problem: message(e) } } : l));
    }
  }, []);
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

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
    url, setUrl, capture, options, busy, error, designSystems, kits, current, appearance, setAppearance, live, sourcesOf,
    showSources(kitId) {
      if (kitId && !kits.some((k) => k.id === kitId)) return { ok: false, code: "UNKNOWN_KIT", message: `No brand kit ${kitId}; kits: ${kits.map((k) => k.id).join(", ") || "none"}` };
      setSourcesOf(kitId);
      return { ok: true, data: kitId ? { shown: `The sources of ${kitId}: the website or logo it was read from, its screenshot, colours and where each was seen, and what was chosen` } : { shown: "closed" } };
    },
    setSetting(optionId, name, v) {
      const base = capture?.options.find((o) => o.id === optionId);
      if (!base) return;
      const values = { ...(drafts.current[optionId] ?? (adjusted[optionId] ?? base).settings), [name]: v };
      drafts.current[optionId] = values;
      setLive((l) => ({ ...l, [optionId]: { values, updating: true, problem: l[optionId]?.problem ?? null } }));
      // A throttle, not a debounce: while a slider is dragged the option is made again every LIVE_MS, always from its latest position.
      if (!timers.current.has(optionId)) timers.current.set(optionId, setTimeout(() => { void remake(optionId); }, LIVE_MS));
    },
    isChanged(optionId) {
      const base = capture?.options.find((o) => o.id === optionId);
      const values = drafts.current[optionId] ?? live[optionId]?.values;
      return !!adjusted[optionId] || (!!base && !!values && Object.keys(diffOf(values, base)).length > 0);
    },
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
      // Adjustments are settings, not colours: they carry over to the new design system, including a slider still being moved.
      const carried: Record<string, Record<string, number>> = {};
      for (const o of Object.values(adjusted)) if (o.adjusted) carried[o.id] = o.adjusted;
      for (const [id, values] of Object.entries(drafts.current)) {
        const base = capture.options.find((o) => o.id === id);
        if (!base) continue;
        const diff = diffOf(values, base);
        if (Object.keys(diff).length) carried[id] = diff; else delete carried[id];
      }
      settle();
      try {
        const c = await api.brandCapture(capture.id, name);
        const again: Record<string, PaletteOption> = {};
        for (const [id, adjust] of Object.entries(carried)) {
          try { again[id] = await api.adjustBrandOption(c.id, { optionId: id, designSystem: name, adjust }); } catch { /* that adjustment does not fit this design system: the option as offered */ }
        }
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
        // The sliders follow: they now show the settings this option was made with.
        settle(optionId);
        setAdjusted((a) => ({ ...a, [optionId]: o }));
        return { ok: true, data: { option: optionId, settings: o.settings, buttons: o.swatches.light.structure, links: o.swatches.light.accent, page: o.swatches.light.ground, review: o.findings.map((f) => `${f.rule}: ${f.message}`) } };
      } catch (e) { setError(message(e)); return fail(e); } finally { setBusy(null); }
    },
    resetOption(optionId) {
      const base = capture?.options.find((o) => o.id === optionId);
      if (!base) return { ok: false, code: "UNKNOWN_OPTION", message: capture ? `No option ${optionId}; options: ${capture.options.map((o) => o.id).join(", ")}` : "Read a website's or logo's brand first" };
      settle(optionId);
      setAdjusted((a) => { const { [optionId]: _, ...rest } = a; return rest; });
      return { ok: true, data: { option: optionId, settings: base.settings, buttons: base.swatches.light.structure, links: base.swatches.light.accent, page: base.swatches.light.ground } };
    },
    async chooseOption(optionId, name, by = "person") {
      if (!capture) return { ok: false, code: "NO_CAPTURE", message: "Read a website's or logo's brand first" };
      const option = options.find((o) => o.id === optionId);
      if (!option) return { ok: false, code: "UNKNOWN_OPTION", message: `No option ${optionId}; options: ${options.map((o) => o.id).join(", ")}` };
      // The sliders' latest position, even if the option has not been made again from it yet; the last good one if it cannot be.
      const base = capture.options.find((o) => o.id === optionId)!;
      const draft = drafts.current[optionId];
      const adjust = draft && !live[optionId]?.problem ? diffOf(draft, base) : option.adjusted ?? {};
      setBusy("saving"); setError(null);
      try {
        const kit = await api.saveBrandKit({ captureId: capture.id, optionId, designSystem: capture.designSystem, name: name || capture.name, ...(Object.keys(adjust).length ? { adjust } : {}) });
        const r = await setLook({ brandKit: kit.id, designSystem: kit.designSystem, appearance }, `Brand: ${kit.name} (${option.title}${Object.keys(adjust).length ? ", adjusted" : ""})`, by);
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
  }), [url, capture, options, adjusted, busy, error, designSystems, kits, current, appearance, live, sourcesOf, setLook, refreshKits, setCapture, settle, remake]);

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
