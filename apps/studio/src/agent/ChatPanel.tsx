/* The person's assistant panel, outside the routed tree (it is the person's own
   tool, not something the agent operates). It renders OUI's conversation with
   ux-builder's own Conversation, and OUI's approval card with ux-builder
   widgets, so an irreversible step waits for the person's click. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard, useAgent, useAgentStatus } from "@ouispec/agent-react";
import { Button, Card, MenuButton, Notice, StatusPill } from "@ux-builder/ui";
import { api } from "../api";
import { Conversation } from "@ux-builder/ui/assistant";
import type { AgentSession } from "./AgentRoot";
import { REPLYING_PHRASES } from "./phrases";
import { useLocationPath } from "../router";
import { HistoryView } from "./HistoryView";
import { DockControls, useDock } from "./ChatDock";

const CONVERSATION_STRINGS = { assistant: "App Expert", replying: REPLYING_PHRASES, replyingStatus: "Working on a reply…" };

const ACTION_TITLES: Record<string, (input: any) => string> = {
  app_apply_operations: (i) => `Changed the app: ${i?.summary ?? "applied operations"}`,
  app_set_preview: (i) => `Preview${i?.person ? ` as ${i.person}` : ""}${i?.screen ? ` · ${i.screen}` : ""}${i?.appearance ? ` · ${i.appearance}` : ""}`,
  app_show_panel: (i) => `Showed the ${i?.panel ?? ""} panel`,
  app_create_variant: (i) => `Created variant ${i?.name ?? ""}`,
  app_restore_version: (i) => `Restored version ${i?.version ?? ""}`,
  app_reset_data: () => "Reset the sample data",
  catalog_create_app: (i) => `Created the app ${i?.name ?? ""}`,
  catalog_open_app: (i) => `Opened ${i?.appId ?? "an app"}`,
};

function toolTitle(name: string, args: any) {
  // A restored conversation names a UI action directly, with its input as the arguments.
  if (ACTION_TITLES[name]) return ACTION_TITLES[name](args);
  if (name === "ui_act") {
    const t = ACTION_TITLES[args?.action];
    return t ? t(args?.input) : `Used ${String(args?.action ?? "a control").replace(/_/g, " ")}`;
  }
  if (name === "ui_read" || name === "ui_describe") return "Looked at the page";
  if (name === "ui_wait") return "Waited for the page";
  if (name === "ui_guide") return "Read the studio guide";
  return name.replace(/_/g, " ");
}

function toConversation(messages: any[]) {
  const out: any[] = [];
  let turn: any = null;
  for (const original of messages) {
    // A refused provider request reads "No output generated…"; the panel's notice says why.
    const m = original.role === "assistant" && /^No output generated/i.test(original.content ?? "")
      ? { ...original, content: "I couldn't reply: the AI model refused the request. See the notice above." }
      : original;
    if (m.role === "user") {
      out.push({ id: m.id, role: "user", status: "done", text: m.content ?? "" });
      turn = null;
      continue;
    }
    if (m.role === "staff") continue;
    if (!turn) {
      turn = { id: `t-${m.id}`, role: "assistant", status: "done", parts: [] };
      out.push(turn);
    }
    if (m.role === "tool" && m.toolCall) {
      const tc = m.toolCall;
      const failed = tc.status === "error" || (tc.result && typeof tc.result === "object" && (tc.result as any).ok === false);
      turn.parts.push({ type: "tool", id: tc.id, name: tc.name, title: toolTitle(tc.name, tc.arguments), status: tc.status === "running" ? "running" : failed ? "failed" : "done", input: tc.arguments, output: tc.result, error: failed ? (tc.result as any)?.message ?? "Refused" : undefined });
    } else if (m.role === "assistant" && m.content) {
      turn.parts.push({ type: "text", text: m.content });
    }
    if (m.isStreaming) turn.status = "streaming";
  }
  return out;
}

export function ChatPanel({ session }: { session: AgentSession | null }) {
  if (!session) {
    return (
      <aside className="studio-chat" aria-label="Assistant">
        <Card title="App Expert unavailable">The studio server is running without its agent. Everything still works by hand.</Card>
      </aside>
    );
  }
  return <LiveChat session={session} />;
}

/* The model's availability, re-read while it has a problem so the notice clears itself. */
function useModelProblem(initial: string | null | undefined) {
  const [problem, setProblem] = useState<string | null>(initial ?? null);
  useEffect(() => {
    if (!problem) return;
    const t = setInterval(() => { api.agentSession().then((s: any) => setProblem(s.problem ?? null), () => {}); }, 30000);
    return () => clearInterval(t);
  }, [problem]);
  return problem;
}

/* The conversation as a file: Markdown for people, the full OUI session record
   (every call with its arguments and outcome, and the logs) as JSON. */
function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sessionMarkdown(messages: any[], session: AgentSession) {
  const appId = decodeURIComponent(window.location.pathname.split("/apps/")[1] ?? "") || null;
  const lines = [
    "# UX Builder Studio: assistant session",
    "",
    `- Exported: ${new Date().toISOString()}`,
    `- Model: ${session.model}`,
    ...(appId ? [`- App: ${appId}`] : []),
    "",
  ];
  for (const m of messages) {
    const when = m.timestamp ? new Date(m.timestamp).toISOString().replace("T", " ").slice(0, 19) : "";
    if (m.role === "user") lines.push(`## You · ${when}`, "", m.content ?? "", "");
    else if (m.role === "assistant" && m.content) lines.push(`## Assistant · ${when}`, "", m.content, "");
    else if (m.role === "tool" && m.toolCall) {
      const tc = m.toolCall;
      lines.push(`### Step: ${toolTitle(tc.name, tc.arguments)} (${tc.status})`, "", "```json", JSON.stringify({ tool: tc.name, arguments: tc.arguments, result: tc.result }, null, 2), "```", "");
    }
  }
  return lines.join("\n");
}

/* Ways to start, for where the person is: a new app from the catalog, or more
   work on the app that is open. Shown while the conversation is empty. */
const START_NEW = [
  { label: "Build a time tracker", prompt: "I need a time tracking and invoicing app: employees log time from their calendar, put it on invoices with expenses and receipts, and submit them to accounts payable, who review, return or approve them and mark them paid." },
  { label: "What can the studio build?", prompt: "What kinds of apps can the studio build, and what do you need from me to start one?" },
];
const START_OPEN = [
  { label: "Add a feature", prompt: "I'd like to add a feature to this app. Ask me what it should do, then suggest how it fits the app's data, screens and roles." },
  { label: "Explain this app", prompt: "Explain how this app works: its people and roles, its data, and what each screen is for." },
  { label: "Check it for problems", prompt: "Check this app for problems (validation warnings, missing screens or actions, gaps for any role) and suggest fixes." },
];

function LiveChat({ session }: { session: AgentSession }) {
  const agent = useAgent() as any;
  const dock = useDock();
  const path = useLocationPath();
  const inApp = path.startsWith("/apps/");
  const appId = inApp ? decodeURIComponent(path.split("/apps/")[1]?.split("/")[0] ?? "") || null : null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyAvailable = !!agent.history?.available;
  const problem = useModelProblem(session.problem);
  const status = (useAgentStatus() as any) ?? {};
  const state: string = status.state ?? "idle";
  // From the moment a message is sent until the turn shows it is working (or ends),
  // the panel says so: the model can take a few seconds before its first word.
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    if (pending == null) return;
    if (state === "working" || state === "needs-you") return;
    if ((state === "done" || state === "problem") && Date.now() - pending > 500) setPending(null);
    const t = setTimeout(() => setPending(null), 120000);
    return () => clearTimeout(t);
  }, [pending, state]);
  const busy = pending != null || state === "working" || !!agent.isProcessing || !!agent.isStreaming;
  const conversation = useMemo(() => {
    const out = toConversation(agent.messages ?? []);
    const last = out.at(-1);
    // An assistant reply in progress before its first word or step.
    if (busy && (!last || last.role === "user")) out.push({ id: "pending-reply", role: "assistant", status: "streaming", parts: [] });
    return out;
  }, [agent.messages, busy]);
  // A conversation is filed under the app it worked on: the one open when a turn
  // ends (a build that starts in the catalog ends in the new app).
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && appId && agent.conversationId && agent.history?.manage?.update) {
      agent.history.update([agent.conversationId], { scopeId: appId }).catch(() => {});
    }
    wasBusy.current = busy;
  }, [busy, appId, agent.conversationId]);
  // The reply in progress says it is working (with its phrases); this line adds what the step is, when OUI says.
  const activity = busy ? (status.activity ?? null) : null;
  const label = busy ? "Working" : state === "needs-you" ? "Needs you" : state === "problem" ? "Problem" : "Ready";
  const tone = busy ? "evaluation" : state === "needs-you" ? "limited" : state === "problem" ? "closed" : "live";
  const send = (text: string) => {
    setPending(Date.now());
    return agent.sendMessage(text);
  };
  const exportMarkdown = () => download(`studio-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`, "text/markdown", sessionMarkdown(agent.messages ?? [], session));
  const exportJson = () => {
    const record = agent.debug?.sessionRecord?.() ?? { messages: agent.messages ?? [] };
    const appId = decodeURIComponent(window.location.pathname.split("/apps/")[1] ?? "") || null;
    download(`studio-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, "application/json", JSON.stringify({ studio: { model: session.model, appId, exportedAt: new Date().toISOString() }, ...record }, null, 2));
  };
  return (
    <aside className="studio-chat" aria-label="App Expert">
      <header className="studio-chat__head" {...(dock?.gripProps ?? {})}>
        <div className="studio-chat__title-row">
          <strong className="studio-chat__title">App Expert</strong>
          <StatusPill state={tone}>{label}</StatusPill>
          <span className="studio-chat__spacer" />
          <DockControls />
          <MenuButton icon="more" buttonLabel="More: export this conversation" variant="text" size="sm" align="end" items={[
            { label: "Export conversation (Markdown)", onSelect: exportMarkdown, disabled: !(agent.messages ?? []).length },
            { label: "Export full session record (JSON)", onSelect: exportJson, disabled: !(agent.messages ?? []).length },
          ]} />
        </div>
        <div className="studio-chat__tools">
          <Button variant="text" size="sm" disabled={busy} onClick={() => { setPending(null); setHistoryOpen(false); agent.startNewConversation?.(); }}>New chat</Button>
          {historyAvailable ? (
            <Button variant="text" size="sm" aria-pressed={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>History</Button>
          ) : null}
        </div>
      </header>
      <p className="studio-chat__model" title={session.description}>{session.model === "scripted" ? "Scripted builder (no AI model configured)" : session.model}</p>
      <p className="studio-chat__activity" role="status" aria-live="polite">{activity ?? ""}</p>
      {problem ? <Notice tone="warning" title="The App Expert can't reply yet">{problem}</Notice> : null}
      <ApprovalCard
        components={{
          Card: ({ title, subtitle, children, actions }: any) => (
            <Card title={title} actions={actions}>
              {subtitle ? <p>{subtitle}</p> : null}
              {children}
            </Card>
          ),
          Button: ({ variant, onClick, disabled, children }: any) => (
            <Button variant={variant === "primary" ? "primary" : "secondary"} onClick={onClick} disabled={disabled}>{children}</Button>
          ),
        } as any}
      />
      {historyOpen ? (
        <HistoryView agent={agent} appId={appId} busy={busy} onClose={() => setHistoryOpen(false)} />
      ) : agent.isLoadingConversation ? (
        <p className="studio-meta" role="status">Opening the conversation…</p>
      ) : (
      <Conversation
        messages={conversation}
        onSend={send}
        onStop={busy ? () => { setPending(null); agent.stopTurn(); } : undefined}
        suggestions={conversation.length ? [] : inApp ? START_OPEN : START_NEW}
        composerLabel="Message the App Expert"
        strings={CONVERSATION_STRINGS as any}
        label="Conversation with the App Expert"
      />
      )}
    </aside>
  );
}
