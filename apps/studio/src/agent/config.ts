/* The agent provider's seams: the studio API starts turns; the tab's OUI
   snapshot and the page's knowledge ride every turn. */
import type { AgentClientConfig } from "@ouispec/agent-react";
import { resolveKnowledge } from "@ouispec/bindings";
import { ouiRuntime, uiKnowledge } from "./oui-runtime";

/* A JSON reply, or the server's reason as an error the history view can show. */
async function json(res: Response) {
  if (res.status === 204) return undefined;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `The studio answered ${res.status}`);
  return body;
}

export function agentConfig(session: { realtimeUrl: string; token: string }): AgentClientConfig {
  return {
    createConversation: async () => (await fetch("/api/agent/conversations", { method: "POST" })).json(),
    sendMessage: async ({ conversationId, content, context, approval, resume }: any) => {
      const currentPath = context?.currentPath ?? window.location.pathname;
      const res = await fetch(`/api/agent/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          context: { ...context, oui: ouiRuntime.snapshot(), uiKnowledge: resolveKnowledge(uiKnowledge, currentPath) },
          ...(approval ? { approval } : {}),
          ...(resume ? { resume } : {}),
        }),
      });
      return res.json();
    },
    stopTurn: async ({ turnId }: { turnId: string }) => {
      await fetch(`/api/agent/turns/${turnId}/stop`, { method: "POST" });
    },
    // History: earlier conversations, kept by the studio server. With getConversation,
    // OUI also reopens the tab's conversation after a reload.
    listConversations: async ({ limit, offset, scopeId, status, search }: any) => {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (scopeId !== undefined) q.set("scopeId", scopeId ?? "");
      if (status) q.set("status", status);
      if (search) q.set("search", search);
      return json(await fetch(`/api/agent/conversations?${q}`));
    },
    getConversation: async (conversationId: string) => json(await fetch(`/api/agent/conversations/${encodeURIComponent(conversationId)}`)),
    renameConversation: async (conversationId: string, title: string | null) =>
      json(await fetch(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) })),
    updateConversations: async (conversationIds: string[], changes: unknown) =>
      json(await fetch("/api/agent/conversations/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationIds, changes }) })),
    deleteConversations: async (conversationIds: string[]) => {
      await json(await fetch("/api/agent/conversations/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationIds }) }));
    },
    activeConversationKey: "ux-builder-studio.activeConversation",
    grantApproval: (grant: any) => (ouiRuntime as any).grantApproval(grant),
    settledWork: { subscribe: (listener: any) => (ouiRuntime as any).onSettled(listener) },
    realtime: { url: session.realtimeUrl, getToken: () => session.token },
    // Shown as the assistant's activity while it thinks before its first step.
    planningText: "Thinking…",
  } as unknown as AgentClientConfig;
}
