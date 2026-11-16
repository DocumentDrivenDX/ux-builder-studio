/* The brand step for the open app: read a website's brand, see three palette
   options on a design system, keep one as a brand kit and dress the app in
   it, or use a kit already in the studio's library. The Brand panel and the
   app room (so the App Expert) share this state, so either can start a
   capture and the other sees it. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type BrandCapture, type BrandKit, type DesignSystemInfo, type KitTokens } from "../api";
import { useStudio } from "../studio";

export type BrandResult = { ok: true; data?: Record<string, unknown> } | { ok: false; code: string; message: string };

type Brand = {
  url: string;
  setUrl(url: string): void;
  capture: BrandCapture | null;
  busy: "capturing" | "options" | "saving" | null;
  error: string | null;
  designSystems: DesignSystemInfo[];
  kits: BrandKit[];
  /** The kit the app wears, if any. */
  current: BrandKit | null;
  captureFromUrl(url?: string): Promise<BrandResult>;
  setDesignSystem(name: string): Promise<BrandResult>;
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

export function BrandProvider({ children }: { children: ReactNode }) {
  const s = useStudio();
  const [url, setUrl] = useState("");
  const [capture, setCapture] = useState<BrandCapture | null>(null);
  const [busy, setBusy] = useState<Brand["busy"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [designSystems, setDesignSystems] = useState<DesignSystemInfo[]>([]);
  const [kits, setKits] = useState<BrandKit[]>([]);

  const refreshKits = useCallback(async () => { setKits((await api.brandKits()).kits); }, []);
  useEffect(() => {
    api.designSystems().then((r) => setDesignSystems(r.designSystems)).catch(() => {});
    refreshKits().catch(() => {});
  }, [refreshKits]);

  const kitId = s.view?.definition.extensions?.["umf.ux"]?.look?.brandKit ?? null;
  const current = kits.find((k) => k.id === kitId) ?? null;

  const setLook = useCallback(async (args: Record<string, string>, summary: string, by: string): Promise<BrandResult> => {
    const r = await s.apply([{ op: "setLook", args }], summary, by);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    await refreshKits().catch(() => {});
    return { ok: true };
  }, [s, refreshKits]);

  const value = useMemo<Brand>(() => ({
    url, setUrl, capture, busy, error, designSystems, kits, current,
    async captureFromUrl(given) {
      const target = (given ?? url).trim();
      if (given !== undefined) setUrl(given);
      if (!target) { setError("Enter the website's address"); return { ok: false, code: "URL_REQUIRED", message: "Give the website's address" }; }
      setBusy("capturing"); setError(null);
      try {
        const c = await api.captureBrand(target);
        setCapture(c);
        return { ok: true, data: { captured: c.finalUrl, name: c.name, colours: c.analysis.colours.map((x) => x.hex), designSystem: c.designSystem, options: c.options.map((o) => o.id), notes: c.notes } };
      } catch (e) {
        setError(message(e));
        return { ok: false, code: code(e), message: message(e) };
      } finally { setBusy(null); }
    },
    async setDesignSystem(name) {
      if (!capture) return { ok: false, code: "NO_CAPTURE", message: "Read a website's brand first" };
      setBusy("options"); setError(null);
      try {
        const c = await api.brandCapture(capture.id, name);
        setCapture(c);
        return { ok: true, data: { designSystem: c.designSystem, options: c.options.map((o) => o.id) } };
      } catch (e) {
        setError(message(e));
        return { ok: false, code: code(e), message: message(e) };
      } finally { setBusy(null); }
    },
    async chooseOption(optionId, name, by = "person") {
      if (!capture) return { ok: false, code: "NO_CAPTURE", message: "Read a website's brand first" };
      const option = capture.options.find((o) => o.id === optionId);
      if (!option) return { ok: false, code: "UNKNOWN_OPTION", message: `No option ${optionId}; options: ${capture.options.map((o) => o.id).join(", ")}` };
      setBusy("saving"); setError(null);
      try {
        const kit = await api.saveBrandKit({ captureId: capture.id, optionId, designSystem: capture.designSystem, name: name || capture.name });
        const r = await setLook({ brandKit: kit.id, designSystem: kit.designSystem }, `Brand: ${kit.name} (${option.title})`, by);
        if (!r.ok) { setError(r.message); return r; }
        return { ok: true, data: { kit: kit.id, name: kit.name } };
      } catch (e) {
        setError(message(e));
        return { ok: false, code: code(e), message: message(e) };
      } finally { setBusy(null); }
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
      } catch (e) {
        return { ok: false, code: code(e), message: message(e) };
      }
    },
  }), [url, capture, busy, error, designSystems, kits, current, setLook, refreshKits]);

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
