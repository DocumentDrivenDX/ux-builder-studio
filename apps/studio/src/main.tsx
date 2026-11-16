import "@ux-builder/tokens/themes.css";
import "@ux-builder/tokens/fonts.css";
import "@ux-builder/ui/ui.css";
import "@ux-builder/ui/patterns.css";
import "@ux-builder/app-runtime/runtime.css";
import "./studio.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, ToastProvider } from "@ux-builder/ui";
import { AgentRoot, type AgentSession } from "./agent/AgentRoot";
import { ChatPanel } from "./agent/ChatPanel";
import { ChatDock } from "./agent/ChatDock";
import { AppRoutes } from "./routes";
import { navigate, useLocationPath } from "./router";

function Shell() {
  const [session, setSession] = useState<AgentSession | null>(null);
  const path = useLocationPath();
  const running = path.startsWith("/run/");
  return (
    <ThemeProvider theme="ux-builder-databricks" appearance="light" className="studio-root">
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
              </header>
              <main className="studio__main"><AppRoutes /></main>
              <ChatDock><ChatPanel session={session} /></ChatDock>
            </div>
          )}
        </AgentRoot>
      </ToastProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
