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

function Shell() {
  const [session, setSession] = useState<AgentSession | null>(null);
  const path = useLocationPath();
  const running = path.startsWith("/run/");
  return (
    <StudioAppearanceProvider>{(appearance) => (
    <ThemeProvider theme="ux-builder-databricks" appearance={appearance} className="studio-root">
      <ToastProvider>
        <AgentRoot onSession={setSession}>
          {running ? (
            <AppRoutes />
          ) : (
            <div className="studio">
              <header className="studio__bar">
                <a className="studio__brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>UX Builder Studio</a>
                <span className="studio-meta">
                  Apps are <a className="studio-link" href="https://github.com/DocumentDrivenDX/umf" target="_blank" rel="noreferrer">UMF</a> definitions, rendered with{" "}
                  <a className="studio-link" href="https://github.com/DocumentDrivenDX/ux-builder" target="_blank" rel="noreferrer">ux-builder</a>
                </span>
                <AppearanceToggle />
              </header>
              <main className="studio__main"><AppRoutes /></main>
              <ChatDock><ChatPanel session={session} /></ChatDock>
            </div>
          )}
        </AgentRoot>
      </ToastProvider>
    </ThemeProvider>
    )}</StudioAppearanceProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
