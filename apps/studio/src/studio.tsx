/* The builder's state for the open app: its definition and verdict (reloaded
   whenever the server says the app changed), the preview (who it is signed in
   as, which screen), the panel shown, and every edit, through the same API the
   agent's room uses. Pages read it through useStudio(), so routed pages pass
   no callbacks around: their only callbacks are bound ux-builder controls. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Identity, Location } from "@ux-builder/app-runtime/contract";
import { api, onChange, type AppView } from "./api";
import { navigate } from "./router";
import { rolesFor, useSession, type Me } from "./session";

/* Who the preview runs as. On sample data: the app's sample people. On the
   organisation's data (an app with catalog sources): the signed-in person,
   with the roles their groups give them, or trying one role at a time; the
   catalog answers as them either way, so nobody sees anyone else's data. */
export function previewPeople(view: AppView | null, me: Me | null): Identity[] {
  const app = view?.definition.extensions?.["umf.app"];
  if (!app) return [];
  if (!(app.sources ?? []).length) return app.samples?.identities ?? [];
  if (!me) return [];
  const roles: Array<{ id: string; name: string; groups?: string[] }> = app.roles ?? [];
  const mine = rolesFor(me, roles);
  const you: Identity = { id: "me", name: `${me.name} (you)`, email: me.email, roles: mine.length || !view?.access?.edit ? mine : roles.map((r) => r.id), attributes: { groups: me.groups } };
  const tries: Identity[] = view?.access?.edit ? roles.map((r) => ({ id: `role:${r.id}`, name: `You, as ${r.name}`, email: me.email, roles: [r.id], attributes: { groups: me.groups } })) : [];
  return [you, ...tries];
}

export type Panel = "overview" | "brand" | "data" | "screens" | "actions" | "diagrams" | "rules" | "versions" | "deployment";
export const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "brand", label: "Brand and style" },
  { id: "data", label: "Data" },
  { id: "screens", label: "Screens" },
  { id: "actions", label: "Actions" },
  { id: "diagrams", label: "Diagrams" },
  { id: "rules", label: "Rules" },
  { id: "versions", label: "Versions" },
  { id: "deployment", label: "Database" },
];

/* The builder shows one of two tabs at a time: the app's configuration panels, or its live preview. */
export type BuilderTab = "configuration" | "preview";
export const BUILDER_TABS: Array<{ id: BuilderTab; label: string }> = [
  { id: "configuration", label: "App configuration" },
  { id: "preview", label: "App preview" },
];

export type ApplyResult = { ok: true; version: number; redeployed: boolean } | { ok: false; code: string; message: string; errors?: Array<{ code: string; path: string; message: string }> };

type Studio = {
  appId: string;
  view: AppView | null;
  error: string | null;
  tab: BuilderTab;
  setTab(t: BuilderTab): void;
  panel: Panel;
  /** Shows a configuration panel (and the configuration tab). */
  setPanel(p: Panel): void;
  people: Identity[];
  person: Identity | null;
  setPerson(id: string): void;
  location: Location | undefined;
  setLocation(l: Location | undefined): void;
  appearance: "system" | "light" | "dark";
  apply(operations: Array<{ op: string; args?: unknown }>, summary: string, by?: string): Promise<ApplyResult>;
  variant(name: string, note?: string, by?: string): Promise<{ ok: boolean; id?: string; message?: string }>;
  restore(version: number, by?: string): Promise<{ ok: boolean; message?: string }>;
  reset(): Promise<void>;
  reload(): Promise<void>;
  previewKey: number;
  /** The app reads the organisation's data catalog (as whoever uses it). */
  live: boolean;
};

const StudioContext = createContext<Studio | null>(null);
export const useStudio = () => {
  const s = useContext(StudioContext);
  if (!s) throw new Error("useStudio outside StudioProvider");
  return s;
};

export function StudioProvider({ appId, children }: { appId: string; children: ReactNode }) {
  const [view, setView] = useState<AppView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<BuilderTab>("configuration");
  const [panel, setPanelState] = useState<Panel>("overview");
  const setPanel = useCallback((p: Panel) => { setPanelState(p); setTab("configuration"); }, []);
  const [personId, setPersonId] = useState<string | null>(null);
  const [location, setLocation] = useState<Location | undefined>(undefined);
  const [previewKey, setPreviewKey] = useState(0);
  const version = useRef(0);

  const reload = useCallback(async () => {
    try {
      const v = await api.app(appId);
      version.current = v.version;
      setView(v);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [appId]);

  useEffect(() => {
    setView(null);
    setPersonId(null);
    setLocation(undefined);
    reload();
    return onChange((e) => {
      if (e.appId !== appId) return;
      if (e.kind === "definition" && e.version !== version.current) reload();
      if (e.kind === "data") setPreviewKey((k) => k + 1);
    });
  }, [appId, reload]);

  const { me } = useSession();
  const live = !!(view?.definition.extensions?.["umf.app"]?.sources ?? []).length;
  const people: Identity[] = useMemo(() => previewPeople(view, me), [view, me]);
  const person = people.find((p) => p.id === personId) ?? people[0] ?? null;
  const appearance = view?.definition.extensions?.["umf.ux"]?.look?.appearance ?? "system";

  const value = useMemo<Studio>(() => ({
    appId, view, error, tab, setTab, panel, setPanel, people, person, previewKey, live,
    setPerson: (id) => { setPersonId(id); setLocation(undefined); },
    location, setLocation, appearance,
    reload,
    async apply(operations, summary, by = "person") {
      try {
        const v = await api.apply(appId, operations, summary, by);
        version.current = v.version;
        setView(v);
        setPreviewKey((k) => k + 1);
        return { ok: true, version: v.version, redeployed: v.redeployed };
      } catch (e: any) {
        const b = e?.body ?? {};
        return { ok: false, code: b.code ?? "ERROR", message: b.message ?? String(e?.message ?? e), errors: b.details?.errors };
      }
    },
    async variant(name, note, by = "person") {
      try {
        const v = await api.variant(appId, { name, note, by });
        navigate(`/apps/${encodeURIComponent(v.definition.id)}`);
        return { ok: true, id: v.definition.id };
      } catch (e: any) {
        return { ok: false, message: e?.body?.message ?? String(e?.message ?? e) };
      }
    },
    async restore(v, by = "person") {
      try {
        const r = await api.restore(appId, v, by);
        version.current = r.version;
        setView(r);
        setPreviewKey((k) => k + 1);
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.body?.message ?? String(e?.message ?? e) };
      }
    },
    async reset() {
      await api.reset(appId);
      setPreviewKey((k) => k + 1);
    },
  }), [appId, view, error, tab, panel, setPanel, people, person, location, appearance, reload, previewKey, live]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

/* Short, plain descriptions of validation problems for people and the agent. */
export const describeProblem = (d: { code: string; path: string; message: string }) => `${d.message} (${d.code} at ${d.path || "/"})`;
