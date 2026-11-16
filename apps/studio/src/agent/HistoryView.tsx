/* The App Expert's chat history, inside the chat panel: earlier
   conversations, newest first, filed by the app each was about. Open one to
   read it and carry on; search them; rename, archive or delete them. The
   conversations are kept by the studio server (server/agent/conversations.ts);
   OUI's provider lists, loads and switches them (useAgent().history). */
import { useEffect, useMemo, useState } from "react";
import { Button, ChoicePicker, Dialog, MenuButton, Notice, Spinner, TextField } from "@ux-builder/ui";
import { ConfirmDialog } from "@ux-builder/ui/patterns";

type Summary = {
  conversationId: string;
  title: string | null;
  preview?: string | null;
  lastActiveAt?: string;
  updatedAt: string;
  scope?: { id: string; name: string } | null;
  archivedAt?: string | null;
  matches?: Array<{ messageId: string; excerpt: string }>;
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function when(iso: string | undefined) {
  if (!iso) return "";
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
const nameOf = (c: Summary) => c.title || c.preview || "Untitled conversation";

export function HistoryView({ agent, appId, busy, onClose }: { agent: any; appId: string | null; busy: boolean; onClose: () => void }) {
  const history = agent.history;
  const [show, setShow] = useState<"app" | "all" | "archived">(appId ? "app" : "all");
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<Summary | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [deleting, setDeleting] = useState<Summary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const filter = useMemo(() => ({
    status: show === "archived" ? "archived" : "active",
    ...(show === "app" && appId ? { scopeId: appId } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }), [show, appId, search]);

  // Fetch on open and whenever the filter changes; typing waits a moment.
  useEffect(() => {
    const t = setTimeout(() => { history.refresh(filter).catch(() => {}); }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const act = async (fn: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await fn();
      await history.refresh(filter);
    } catch (e: any) {
      setProblem(e?.message ?? String(e));
    }
  };
  const open = async (c: Summary) => {
    if (c.conversationId !== agent.conversationId) await agent.switchConversation(c.conversationId);
    onClose();
  };

  const list: Summary[] = history.conversations ?? [];
  const options = [
    ...(appId ? [{ value: "app", label: "This app" }] : []),
    { value: "all", label: "All" },
    { value: "archived", label: "Archived" },
  ];

  return (
    <section className="studio-history" aria-labelledby="studio-history-title">
      <div className="studio-history__head">
        <h2 id="studio-history-title" className="studio-history__title">Chat history</h2>
        <Button variant="text" size="sm" onClick={onClose}>Back to the conversation</Button>
      </div>
      <ChoicePicker label="Show" value={show} options={options} onChange={(v: string) => setShow(v as typeof show)} />
      <TextField label="Search conversations" type="search" value={search} onChange={(e: any) => setSearch(e.target.value)} />
      {busy ? <Notice tone="info" title="A reply is in progress">Opening another conversation waits until it finishes, or stop it first.</Notice> : null}
      {problem || history.error ? <Notice tone="error" title={problem ?? history.error} /> : null}
      <div className="studio-history__list" aria-busy={history.loading ? "true" : "false"}>
        {history.loading && !list.length ? (
          <Spinner label="Loading conversations" showLabel />
        ) : !list.length ? (
          <p className="studio-meta">
            {search ? "No conversation matches." : show === "archived" ? "No archived conversations." : show === "app" ? "No conversations about this app yet." : "No conversations yet."}
          </p>
        ) : (
          <ul className="studio-history__items">
            {list.map((c) => {
              const current = c.conversationId === agent.conversationId;
              return (
                <li key={c.conversationId} className="studio-history__item" aria-current={current ? "true" : undefined}>
                  <div className="studio-history__main">
                    <Button variant="text" className="studio-history__open" disabled={busy && !current} onClick={() => open(c)}>
                      {nameOf(c)}
                    </Button>
                    <p className="studio-history__meta">
                      {[current ? "Open now" : null, c.scope?.name ?? "No app", when(c.lastActiveAt ?? c.updatedAt)].filter(Boolean).join(" · ")}
                    </p>
                    {(c.matches ?? []).slice(0, 1).map((m) => <p key={m.messageId} className="studio-history__match">{m.excerpt}</p>)}
                  </div>
                  <MenuButton
                    label="More"
                    buttonLabel={`More actions for ${nameOf(c)}`}
                    variant="text"
                    size="sm"
                    align="end"
                    items={[
                      ...(history.manage?.rename ? [{ label: "Rename", onSelect: () => { setRenaming(c); setNewTitle(nameOf(c)); } }] : []),
                      ...(history.manage?.update ? [{ label: c.archivedAt ? "Restore from archive" : "Archive", onSelect: () => act(() => history.update([c.conversationId], { archived: !c.archivedAt })), disabled: current && busy }] : []),
                      ...(history.manage?.remove ? [{ label: "Delete", onSelect: () => setDeleting(c), disabled: current && busy }] : []),
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Dialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename the conversation"
        actions={
          <>
            <Button onClick={() => { const c = renaming!; setRenaming(null); act(() => history.rename(c.conversationId, newTitle.trim() || null)); }}>Save</Button>
            <Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
          </>
        }
      >
        <TextField label="Name" hint="Leave it empty to name it after its first message." value={newTitle} onChange={(e: any) => setNewTitle(e.target.value)} />
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        title="Delete this conversation?"
        objectName={deleting ? nameOf(deleting) : ""}
        consequence="The conversation and everything in it are deleted for good. The apps it built or changed are not affected."
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => { const c = deleting!; setDeleting(null); act(() => history.remove([c.conversationId])); }}
      />
    </section>
  );
}
