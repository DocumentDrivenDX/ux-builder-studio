/* <AppView>: a whole app from its definition. The theme and appearance come
   from umf.ux look, the frame and navigation from umf.ux shell (filtered by
   the signed-in person's roles), and every screen from its regions. The data
   comes from a DataClient: a snapshot of the rows the person may see,
   reloaded when the host says the data changed and after every action. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, ICON_NAMES, ThemeProvider, ToastProvider } from "@ux-builder/ui";
import { AppShell, ErrorScreen, Page, StatePanel } from "@ux-builder/ui/patterns";
import { ActionHost } from "./actions";
import { AppContext, hrefOf, type AppContextValue, type AppEvent } from "./context";
import type { AppDefinition, DataClient, Location, Snapshot } from "./contract";
import { ScreenView } from "./ScreenView";
import { createRuntime, homeFor, indexOf, navigationFor, screenById, screenVisible, text } from "./runtime";
import type { UxExtension } from "./definition";

export interface AppViewProps {
  /** The app definition (a UMF document, app profile 0.1). */
  definition: AppDefinition;
  /** Where the data comes from, for one signed-in person. */
  client: DataClient;
  /** Where the person is. Given, the view is controlled (report moves with onLocationChange); omitted, it keeps its own. */
  location?: Location;
  onLocationChange?(location: Location): void;
  /** Everything the person does that the host may want to observe. */
  onEvent?(event: AppEvent): void;
  /** Overrides the definition's appearance (a host's light/dark preview switch). */
  appearance?: "light" | "dark" | "system";
  /** Overrides the definition's theme. */
  theme?: string;
  /** A brand's resolved tokens (--piq-* names without the dashes) for each appearance, as a studio brand kit gives them. Given, they dress the app in place of the theme. */
  tokens?: { light: Record<string, string>; dark: Record<string, string> } | null;
  /** "window" (default) adapts to the window; "container" to the element (its parent then needs a height). */
  adapt?: "window" | "container";
  /** Hosts may pass attributes the view does not use (data-*, …); they are ignored. */
  [attribute: string]: unknown;
}

const EMPTY_SNAPSHOT = (now: string): Snapshot => ({ records: {}, now, revision: -1 });
const KNOWN_ICONS = new Set<string>(ICON_NAMES as string[]);

const DARK = "(prefers-color-scheme: dark)";
function useSystemDark() {
  const [dark, setDark] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(DARK).matches);
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(DARK) : null;
    if (!mq) return undefined;
    const update = () => setDark(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

export function AppView(props: AppViewProps) {
  const ux = (props.definition?.extensions?.["umf.ux"] ?? {}) as UxExtension;
  const preference = props.appearance ?? ux.look?.appearance ?? "system";
  const systemDark = useSystemDark();
  // A brand kit's tokens: the ones for the appearance shown.
  const shown = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  const tokens = props.tokens ? props.tokens[shown] ?? props.tokens.light : undefined;
  return (
    <ThemeProvider theme={tokens ? undefined : props.theme ?? ux.look?.theme ?? "plain"} tokens={tokens} appearance={preference} favicon={false}
      className="app-rt" data-adapt={props.adapt ?? "window"} data-brand-kit={tokens ? ux.look?.brandKit ?? "custom" : undefined}>
      <ToastProvider>
        <AppFrame {...props} />
      </ToastProvider>
    </ThemeProvider>
  );
}

/* ---------- data ---------- */

function useSnapshot(client: DataClient) {
  const [state, setState] = useState<{ client: DataClient; snapshot?: Snapshot; error?: string }>({ client });
  const seq = useRef(0);
  const latest = useRef(client);
  latest.current = client;
  const load = useCallback(async () => {
    const n = ++seq.current;
    // Only the newest load of the current client may land: a reload started by an
    // older client (or an older load) never overwrites what the current one fetched.
    const current = () => n === seq.current && latest.current === client;
    try {
      const snapshot = await client.snapshot();
      if (current()) setState({ client, snapshot });
      else if (latest.current === client) setState((s) => (s.client === client && s.snapshot ? s : { client, snapshot }));
    } catch (e) {
      if (current()) setState((s) => ({ ...s, client, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [client]);
  useEffect(() => {
    void load();
    return client.subscribe(() => { void load(); });
  }, [client, load]);
  // A new client (another person signed in) starts from nothing, not from the last person's rows.
  const current = state.client === client ? state : { client };
  return { snapshot: current.snapshot, error: current.error, reload: load };
}

/* ---------- the frame ---------- */

function AppFrame({ definition, client, location: controlled, onLocationChange, onEvent, adapt = "window" }: AppViewProps) {
  const idx = useMemo(() => indexOf(definition), [definition]);
  const ux = (idx.ux ?? {}) as UxExtension;
  const identity = client.identity;
  const { snapshot, error, reload } = useSnapshot(client);
  const loading = !snapshot;

  const home = useMemo(() => homeFor(ux, identity), [ux, identity]);
  const [own, setOwn] = useState<Location | null>(home);
  // Another person, another home: an uncontrolled view starts again from theirs.
  const who = useRef(identity.id);
  useEffect(() => {
    if (who.current !== identity.id) { who.current = identity.id; setOwn(home); }
  }, [identity.id, home]);
  const location = controlled ?? own ?? home;

  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const locationRef = useRef(location);
  locationRef.current = location;
  const emit = useCallback((e: AppEvent) => eventRef.current?.(e), []);
  const navigate = useCallback((to: Location) => {
    const from = locationRef.current ?? undefined;
    if (controlled === undefined) setOwn(to);
    onLocationChange?.(to);
    emit({ type: "navigate", location: to, from });
  }, [controlled, onLocationChange, emit]);

  const rt = useMemo(
    () => createRuntime(definition, idx, identity, snapshot ?? EMPTY_SNAPSHOT(idx.app?.samples?.clock ?? new Date().toISOString())),
    [definition, idx, identity, snapshot],
  );

  const reloadNow = useCallback(async () => { await reload(); }, [reload]);
  const ctx: AppContextValue = useMemo(
    () => ({ rt, client, loading, location: location ?? { screen: "" }, navigate, reload: reloadNow, emit }),
    [rt, client, loading, location, navigate, reloadNow, emit],
  );

  const navItems = navigationFor(ux, identity);
  const screen = location ? screenById(rt, location.screen) : undefined;
  const nav = navItems.map((n) => ({
    id: n.id,
    label: text(n.label, rt.base) || n.id,
    href: hrefOf({ screen: n.screen }),
    icon: n.icon && KNOWN_ICONS.has(n.icon) ? n.icon : undefined,
  }));
  const current = (navItems.find((n) => n.screen === location?.screen) ?? navItems.find((n) => n.screen === screen?.back?.screen))?.id;

  // After moving to another screen, start at its top with focus on it, as a page load would.
  const content = useRef<HTMLDivElement>(null);
  const screenKey = location ? `${location.screen}/${location.param ?? ""}` : "";
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    content.current?.focus({ preventScroll: true });
    content.current?.scrollIntoView?.({ block: "start" });
  }, [screenKey]);

  let body;
  if (error && !snapshot) {
    body = <Page><StatePanel kind="error" onRetry={() => void reload()}><p>{error}</p></StatePanel></Page>;
  } else if (!location || !screen) {
    body = (
      <ErrorScreen kind="not-found" actions={home ? <Button onClick={() => navigate(home)}>Go to the first page</Button> : undefined}>
        <p>{location ? "This page is not part of the app." : `${identity.name} has no page in this app.`}</p>
      </ErrorScreen>
    );
  } else if (!screenVisible(screen, identity)) {
    body = (
      <ErrorScreen kind="forbidden" actions={home ? <Button onClick={() => navigate(home)}>Go to the first page</Button> : undefined}>
        <p>{`${identity.name} does not have access to this page.`}</p>
      </ErrorScreen>
    );
  } else {
    body = <ScreenView key={screenKey} screen={screen} param={location.param} />;
  }

  const frame = ux.shell?.frame ?? "side-nav";
  return (
    <AppContext.Provider value={ctx}>
      <ActionHost>
        <AppShell
          nav={nav}
          current={current}
          frame={frame}
          adapt={adapt}
          onNavigate={(item: { id: string }) => {
            const n = navItems.find((x) => x.id === item.id);
            if (n) navigate({ screen: n.screen });
          }}
          brand={<span className="app-rt-brand">{ux.shell?.title ?? idx.app?.name}</span>}
          actions={<span className="app-rt-identity"><Icon name="user" /><span>{identity.name}</span></span>}
        >
          <div ref={content} tabIndex={-1} className="app-rt-screen" aria-busy={loading || undefined}>
            {body}
          </div>
        </AppShell>
      </ActionHost>
    </AppContext.Provider>
  );
}
