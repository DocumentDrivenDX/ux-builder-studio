/* The studio's own appearance: light or dark. It follows the computer's
   setting (live, as it changes) until the person picks one with the top
   bar's sun/moon button; from then on their choice is remembered in this
   browser. An app's preview keeps the app's own appearance (look.appearance),
   and a brand option's samples their own. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type StudioAppearance = "light" | "dark";
const KEY = "studio.appearance";
const QUERY = "(prefers-color-scheme: dark)";

function remembered(): StudioAppearance | null {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}
const system = (): StudioAppearance => (typeof window !== "undefined" && window.matchMedia?.(QUERY).matches ? "dark" : "light");

type Ctx = {
  /** What the studio shows now. */
  appearance: StudioAppearance;
  /** Whether it is following the computer's setting (no choice made yet). */
  following: boolean;
  /** The person's choice, remembered; "system" goes back to following the computer. */
  choose(a: StudioAppearance | "system"): void;
};
const AppearanceContext = createContext<Ctx | null>(null);
export const useStudioAppearance = () => {
  const c = useContext(AppearanceContext);
  if (!c) throw new Error("useStudioAppearance outside StudioAppearanceProvider");
  return c;
};

export function StudioAppearanceProvider({ children }: { children(appearance: StudioAppearance): ReactNode }) {
  const [chosen, setChosen] = useState<StudioAppearance | null>(remembered);
  const [os, setOs] = useState<StudioAppearance>(system);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setOs(mq.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const choose = useCallback((a: StudioAppearance | "system") => {
    const v = a === "system" ? null : a;
    setChosen(v);
    try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* not remembered in this browser; still applied */ }
  }, []);
  const appearance = chosen ?? os;
  const value = useMemo(() => ({ appearance, following: !chosen, choose }), [appearance, chosen, choose]);
  return <AppearanceContext.Provider value={value}>{children(appearance)}</AppearanceContext.Provider>;
}

/* What the rooms do for the App Expert's set-studio-appearance action. */
export function setStudioAppearance(c: Ctx, appearance: StudioAppearance | "system") {
  c.choose(appearance);
  return { ok: true as const, data: { appearance: appearance === "system" ? `following the computer's setting (${system()} now)` : appearance } };
}
