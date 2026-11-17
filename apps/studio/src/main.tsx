import "@ux-builder/tokens/themes.css";
import "@ux-builder/tokens/fonts.css";
import "@ux-builder/ui/ui.css";
import "@ux-builder/ui/patterns.css";
import "@ux-builder/app-runtime/runtime.css";
import "./studio.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Icon, ThemeProvider, ToastProvider, Tooltip, registerIcons } from "@ux-builder/ui";
import { iconMoon, iconSun } from "@ux-builder/ui/icons";
import { AgentRoot, type AgentSession } from "./agent/AgentRoot";
import { ChatPanel } from "./agent/ChatPanel";
import { ChatDock } from "./agent/ChatDock";
import { AppRoutes } from "./routes";
import { Button } from "./agent/generated/bound/ux-builder-ui";
import { StudioAppearanceProvider, useStudioAppearance } from "./appearance";
import { navigate, useLocationPath } from "./router";
import { SessionProvider, useSession } from "./session";
import { SignInPage } from "./pages/SignInPage";

registerIcons(iconSun, iconMoon);

/* One button: a moon in light (to go dark), a sun in dark (to go light). */
function AppearanceToggle() {
  const { appearance, choose } = useStudioAppearance();
  const next = appearance === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return (
    <Tooltip content={label} placement="bottom" className="studio__appearance">
      <Button variant="text" className="studio__appearance-button" aria-label={label} data-appearance-now={appearance} onClick={() => choose(next)}
        agent={{ nonAgent: "the studio's light or dark mode; the App Expert uses the set-studio-appearance action" }}>
        <Icon name={appearance === "dark" ? "sun" : "moon"} />
      </Button>
    </Tooltip>
  );
}

/* Who is signed in, and signing out. */
function Me() {
  const { me, auth, signOut, signIn } = useSession();
  if (!me || auth?.mode === "none") return null;
  if (me.solo) {
    return (
      <div className="studio__me">
        <span className="studio__me-name">On your own<span className="studio-meta">Apps with their own data</span></span>
        <Button variant="text" onClick={async () => { await signOut(); signIn(); }} agent={{ nonAgent: "signing in is the person's own step" }}>Sign in to an organisation</Button>
      </div>
    );
  }
  return (
    <div className="studio__me">
      <span className="studio__me-name" title={me.groups.length ? `Groups: ${me.groups.join(", ")}` : undefined}>
        {me.name}
        <span className="studio-meta">{me.builder ? "Builder" : "App user"}</span>
      </span>
      {auth?.mode === "local" ? (
        <Button variant="text" onClick={async () => { await signOut(); signIn(); }} agent={{ nonAgent: "switching person is the person's own sign-in" }}>Switch person</Button>
      ) : null}
      <Button variant="text" onClick={() => void signOut()} agent={{ nonAgent: "signing out is the person's own choice" }}>Sign out</Button>
    </div>
  );
}

function Nav({ path }: { path: string }) {
  const { catalog } = useSession();
  const link = (to: string, label: string, current: boolean) => (
    <a className="studio__nav-link" href={to} aria-current={current ? "page" : undefined} onClick={(e) => { e.preventDefault(); navigate(to); }}>{label}</a>
  );
  return (
    <nav className="studio__nav" aria-label="Studio">
      {link("/", "Apps", path === "/" || path.startsWith("/apps/"))}
      {catalog ? link("/catalog", "Data catalog", path.startsWith("/catalog")) : null}
    </nav>
  );
}

function Shell() {
  return (
    <StudioAppearanceProvider>{(appearance) => (
    <ThemeProvider theme="ux-builder-databricks" appearance={appearance} className="studio-root">
      <ToastProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </ToastProvider>
    </ThemeProvider>
    )}</StudioAppearanceProvider>
  );
}

/* Signed in: the studio. Signed out: the sign-in screen (nothing else asks the server for anything). */
function Gate() {
  const { me, loading } = useSession();
  if (loading) return null;
  if (!me) return <SignInPage />;
  return <Studio />;
}

function Studio() {
  const [session, setSession] = useState<AgentSession | null>(null);
  const path = useLocationPath();
  const running = path.startsWith("/run/");
  return (
        <AgentRoot onSession={setSession}>
          {running ? (
            <AppRoutes />
          ) : (
            <div className="studio">
              <header className="studio__bar">
                <a className="studio__brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>UX Builder Studio</a>
                <Nav path={path} />
                <span className="studio-meta">
                  Apps are <a className="studio-link" href="https://github.com/DocumentDrivenDX/umf" target="_blank" rel="noreferrer">UMF</a> definitions, rendered with{" "}
                  <a className="studio-link" href="https://github.com/DocumentDrivenDX/ux-builder" target="_blank" rel="noreferrer">ux-builder</a>
                </span>
                <Me />
                <AppearanceToggle />
              </header>
              <main className="studio__main"><AppRoutes /></main>
              <ChatDock><ChatPanel session={session} /></ChatDock>
            </div>
          )}
        </AgentRoot>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
