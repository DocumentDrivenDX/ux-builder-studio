/* Who is signed in to the studio, and signing in and out. The studio's
   server keeps the session (an HttpOnly cookie); the browser only asks who
   it is. When a call answers that the session has ended, the studio shows
   the sign-in screen again. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Me = { id: string; name: string; email: string; groups: string[]; builder: boolean };
export type AuthInfo = { mode: "local" | "oidc" | "none"; label: string };
type Session = {
  me: Me | null;
  auth: AuthInfo | null;
  loading: boolean;
  /** Go to the organisation's sign-in, and come back here. */
  signIn(): void;
  signOut(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
};

export const SIGNED_OUT_EVENT = "studio:signed-out";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/me").then((x) => x.json());
      setMe(r.user ?? null);
      setAuth(r.auth ?? null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const out = () => setMe(null);
    window.addEventListener(SIGNED_OUT_EVENT, out);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, out);
  }, [load]);
  const value = useMemo<Session>(() => ({
    me, auth, loading,
    signIn() {
      window.location.href = `/api/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    },
    async signOut() {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      setMe(null);
      window.history.replaceState(null, "", "/");
    },
  }), [me, auth, loading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/* The roles a signed-in person has in an app: those naming one of their groups, or "*" (everyone the app is shared with). */
export function rolesFor(me: Me | null, roles: Array<{ id: string; groups?: string[] }>) {
  if (!me) return [];
  return roles.filter((r) => (r.groups ?? []).some((g) => g === "*" || me.groups.includes(g))).map((r) => r.id);
}
