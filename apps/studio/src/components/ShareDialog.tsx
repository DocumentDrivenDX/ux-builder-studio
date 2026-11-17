/* Sharing an app: who may use it, and who may change it. People and groups
   come from the organisation's sign-in. Sharing an app never shares data:
   each person still sees only what the data catalog lets them see. */
import { useEffect, useState } from "react";
import { Dialog, Notice } from "@ux-builder/ui";
import { Stack } from "@ux-builder/ui/patterns";
import { Button, Select } from "../agent/generated/bound/ux-builder-ui";
import { api, type AppAccess } from "../api";

type Directory = Awaited<ReturnType<typeof api.directory>>;

export function ShareDialog({ appId, appName, open, onClose }: { appId: string; appName: string; open: boolean; onClose(): void }) {
  const [access, setAccess] = useState<AppAccess | null>(null);
  const [dir, setDir] = useState<Directory | null>(null);
  const [who, setWho] = useState("");
  const [as, setAs] = useState<"users" | "editors">("users");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setError(null);
    api.access(appId).then((r) => setAccess(r.access), (e) => setError(e?.body?.message ?? String(e)));
    api.directory().then(setDir).catch(() => {});
  }, [open, appId]);

  const name = (p: string) => {
    if (p === "everyone") return "Everyone in the organisation";
    if (p.startsWith("group:")) return `${dir?.groups.find((g) => g.id === p.slice(6))?.name ?? p.slice(6)} (group)`;
    const email = p.slice(5);
    return dir?.people.find((x) => x.email === email)?.name ?? email;
  };
  const options = [
    { value: "", label: "Choose who" },
    { value: "everyone", label: "Everyone in the organisation" },
    ...(dir?.groups ?? []).map((g) => ({ value: `group:${g.id}`, label: `${g.name} (group)` })),
    ...(dir?.people ?? []).filter((p) => p.email !== access?.owner).map((p) => ({ value: `user:${p.email}`, label: `${p.name}${p.title ? `, ${p.title}` : ""}` })),
  ];
  const save = async (next: AppAccess) => {
    try {
      const r = await api.share(appId, { editors: next.editors, users: next.users });
      setAccess(r.access);
      setSaved(true);
      setError(null);
    } catch (e: any) {
      setError(e?.body?.message ?? String(e?.message ?? e));
    }
  };
  const add = () => {
    if (!access || !who) return;
    const other = as === "users" ? "editors" : "users";
    void save({ ...access, [as]: [...new Set([...access[as], who])], [other]: access[other].filter((p) => p !== who) });
    setWho("");
  };
  const remove = (p: string) => access && void save({ ...access, users: access.users.filter((x) => x !== p), editors: access.editors.filter((x) => x !== p) });
  const rows = access ? [...access.editors.map((p) => ({ p, role: "Can change" })), ...access.users.map((p) => ({ p, role: "Can use" }))] : [];

  return (
    <Dialog open={open} onClose={onClose} title={`Share ${appName}`} description="Sharing the app never shares data: each person still sees only what the data catalog lets them see. Changing an app also needs a studio builder."
      data-non-agent="sharing is the app owner's own decision"
      actions={<Button variant="secondary" onClick={onClose} agent={{ id: "share.close", description: "Close the sharing dialog" }}>Done</Button>}>
      <Stack gap={4}>
        {error ? <Notice tone="error" title={error} role="alert" /> : saved ? <Notice tone="success" title="Saved" /> : null}
        <p className="studio-meta">Owner: {access?.owner ? name(`user:${access.owner}`) : "nobody (an app from before sign-in)"}</p>
        {rows.length ? (
          <ul className="studio-share__list">
            {rows.map(({ p, role }) => (
              <li key={p} className="studio-share__row">
                <span>{name(p)} <span className="studio-meta">· {role}</span></span>
                <Button variant="text" onClick={() => remove(p)} agent={{ nonAgent: "sharing is the app owner's own decision" }}>Remove</Button>
              </li>
            ))}
          </ul>
        ) : <p className="studio-meta">Only you can see this app.</p>}
        <div className="studio-share__add">
          <Select label="Share with" value={who} options={options} onChange={(e: any) => setWho(e.target.value)} agent={{ id: "share.who", description: "A person, group or everyone to share the app with" }} />
          <Select label="They can" value={as} options={[{ value: "users", label: "Use it" }, { value: "editors", label: "Change it (builders only)" }]} onChange={(e: any) => setAs(e.target.value)} agent={{ id: "share.as", description: "Whether they may use the app or also change it" }} />
          <Button onClick={add} disabled={!who} agent={{ id: "share.add", description: "Share the app with the chosen person or group" }}>Share</Button>
        </div>
      </Stack>
    </Dialog>
  );
}
