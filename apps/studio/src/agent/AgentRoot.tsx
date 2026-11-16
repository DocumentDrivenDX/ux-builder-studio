/* The agent around the studio: the provider, the tab's OUI runtime attached to
   the provider's socket, and the binding registry the bound controls and rooms
   register in. Without an agent session (the server runs without one), the
   studio still works by hand. */
import { useEffect, useState, type ReactNode } from "react";
import { AgentProvider, useAgent } from "@ouispec/agent-react";
import { AgentBindingProvider } from "@ouispec/bindings/react";
import { api } from "../api";
import { agentConfig } from "./config";
import { bindingRegistry, ouiRuntime, setAcceptedTurnReader } from "./oui-runtime";

function TabBridge() {
  const { socket, acceptedTurnId } = useAgent() as any;
  useEffect(() => {
    (ouiRuntime as any).attach(socket ?? null);
  }, [socket]);
  useEffect(() => {
    setAcceptedTurnReader(acceptedTurnId);
    return () => setAcceptedTurnReader(null);
  }, [acceptedTurnId]);
  return null;
}

export type AgentSession = { realtimeUrl: string; token: string; model: string; description: string; available?: boolean; problem?: string | null };

export function AgentRoot({ children, onSession }: { children: ReactNode; onSession?: (s: AgentSession | null) => void }) {
  const [session, setSession] = useState<AgentSession | null | undefined>(undefined);
  useEffect(() => {
    api.agentSession().then(setSession, () => setSession(null));
  }, []);
  useEffect(() => {
    if (session !== undefined) onSession?.(session);
  }, [session, onSession]);
  if (session === undefined) return null;
  if (!session) return <AgentBindingProvider registry={bindingRegistry}>{children}</AgentBindingProvider>;
  return (
    <AgentProvider config={agentConfig(session)}>
      <AgentBindingProvider registry={bindingRegistry}>
        <TabBridge />
        {children}
      </AgentBindingProvider>
    </AgentProvider>
  );
}
