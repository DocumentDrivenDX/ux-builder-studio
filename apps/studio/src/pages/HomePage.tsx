/* The catalog: every app built here, and a way to start a new one. A person can
   type the request into the assistant instead; the assistant uses the same
   catalog room to create the app. */
import { useEffect, useState } from "react";
import { Card, Notice, StatusPill } from "@ux-builder/ui";
import { Grid, Page, PageHeader, Stack } from "@ux-builder/ui/patterns";
import { Button, ChoicePicker, Select, TextArea, TextField } from "../agent/generated/bound/ux-builder-ui";
import { api, onChange, type AppKind, type BrandKit, type CatalogEntry, type CatalogInfo, type CatalogTree } from "../api";
import { navigate } from "../router";
import { CatalogRoom } from "../rooms/catalog/CatalogRoom";
import { useSession } from "../session";

const KINDS: Array<{ value: AppKind; label: string; about: string }> = [
  { value: "reporting", label: "Reporting on our data", about: "Dashboards, charts and lists over tables in the data catalog. Read only; everyone sees what the catalog lets them see." },
  { value: "data-management", label: "Managing our data", about: "Look up, add and correct rows in catalog tables. Only the people the catalog lets change a table can change it." },
  { value: "own-data", label: "Its own data", about: "The App Expert designs the app's own records, with sample data to try it out." },
];

export function HomePage() {
  const { me, catalog: canReadCatalog } = useSession();
  const query = new URLSearchParams(window.location.search);
  const [apps, setApps] = useState<CatalogEntry[] | null>(null);
  // What the app is for, and (for apps on the organisation's data) which tables.
  const [catalog, setCatalog] = useState<CatalogInfo | null>(null);
  const [tree, setTree] = useState<CatalogTree | null>(null);
  const [kind, setKind] = useState<AppKind>(() => (["reporting", "data-management", "own-data"].includes(query.get("kind") ?? "") ? (query.get("kind") as AppKind) : "own-data"));
  const [picked, setPicked] = useState<Record<string, "read" | "change">>(() => Object.fromEntries((query.get("tables") ?? "").split(",").filter(Boolean).map((t) => [t, query.get("kind") === "data-management" ? "change" : "read"])));
  const [name, setName] = useState("");
  const [useCase, setUseCase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // How it should look, decided before anything is built.
  const [lookFrom, setLookFrom] = useState<"website" | "logo" | "kit" | "theme">("website");
  const [website, setWebsite] = useState("");
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [kit, setKit] = useState("");
  const [themes, setThemes] = useState<Array<{ value: string; label: string }>>([]);
  const [theme, setTheme] = useState("plain");

  useEffect(() => {
    const load = () => api.apps().then((r) => setApps(r.apps), (e) => setError(String(e?.message ?? e)));
    load();
    api.brandKits().then((r) => { setKits(r.kits); setKit((k) => k || r.kits[0]?.id || ""); }).catch(() => {});
    api.themes().then((r) => setThemes(r.themes.map((t) => ({ value: t.name, label: t.title })))).catch(() => {});
    api.catalog().then((c) => { setCatalog(c); if (c.available && canReadCatalog) api.catalogTree().then((r) => setTree(r.tree)).catch(() => setTree([])); }).catch(() => {});
    if (query.get("kind")) window.history.replaceState(null, "", "/");
    return onChange(() => load());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onData = kind === "reporting" || kind === "data-management";
  const tables = (tree ?? []).flatMap((c) => c.schemas.flatMap((s) => s.tables.map((t) => ({ ...t, schema: s.name }))));
  const toggle = (fullName: string, on: boolean, change: boolean) => setPicked((p) => {
    const next = { ...p };
    if (on) next[fullName] = kind === "data-management" && change ? "change" : "read";
    else delete next[fullName];
    return next;
  });

  const create = async () => {
    if (!name.trim()) return setError("Give the app a name");
    if (lookFrom === "kit" && !kit) return setError("Choose a brand kit, or another way to set the look");
    const sources = Object.entries(picked).map(([asset, access]) => ({ asset, access: kind === "data-management" ? access : ("read" as const) }));
    if (onData && !sources.length) return setError("Choose at least one table from the data catalog");
    if (kind === "data-management" && !sources.some((s) => s.access === "change")) return setError("A data management app changes at least one table: choose one you may change, with Change it on");
    setBusy(true);
    setError(null);
    try {
      const chosenKit = kits.find((k) => k.id === kit);
      const v = await api.createApp({
        name: name.trim(), useCase: useCase.trim(), kind,
        ...(onData ? { sources } : {}),
        ...(lookFrom === "kit" && chosenKit ? { brandKit: chosenKit.id, designSystem: chosenKit.designSystem } : {}),
        ...(lookFrom === "theme" ? { theme } : {}),
      });
      const at = `/apps/${encodeURIComponent(v.definition.id)}`;
      // The brand step opens first, already reading the website.
      if (lookFrom === "website" && website.trim()) navigate(`${at}?panel=brand&brand=${encodeURIComponent(website.trim())}`);
      else if (lookFrom === "logo" || lookFrom === "website") navigate(`${at}?panel=brand`);
      else navigate(at);
    } catch (e: any) {
      setError(e?.body?.message ?? String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <CatalogRoom apps={apps ?? []} />
      <Stack gap={6}>
        <PageHeader title="Your apps" description={me?.builder ? "Describe an app to the App Expert, or start one here. Every app is a definition the studio renders: no code to write or deploy." : "The apps shared with you. Studio builders make apps; ask one to share theirs with you."} />
        {me?.builder ? (
        <Card title="New app">
          <Stack gap={4}>
            <TextField label="App name" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Time tracker" agent={{ id: "new-app.name", description: "The new app's name" }} />
            <TextArea label="What should it do?" hint="Who uses it, and what they need to get done" value={useCase} onChange={(e: any) => setUseCase(e.target.value)} rows={3} agent={{ id: "new-app.use-case", description: "The new app's use case, in the person's words" }} />
            {catalog?.available && canReadCatalog ? (
              <div className="studio-new-look">
                <ChoicePicker label="What kind of app?" value={kind} onChange={(v: string) => setKind(v as AppKind)}
                  options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
                  agent={{ id: "new-app.kind", description: "What the new app is for: reporting on catalog data (read only), managing catalog data (read and change), or its own data model" }} />
                <p className="studio-meta">{KINDS.find((k) => k.value === kind)?.about}</p>
                {onData ? (
                  <fieldset className="studio-pick">
                    <legend className="studio-pick__legend">Which tables? <span className="studio-meta">From {catalog.label}, as you may use them</span></legend>
                    {tree === null ? <p className="studio-meta">Reading the catalog…</p> : !tables.length ? <p className="studio-meta">There are no tables you may read.</p> : tables.map((t) => {
                      const on = t.fullName in picked;
                      return (
                        <div key={t.fullName} className="studio-pick__table" data-checked={on ? "true" : undefined}>
                          <label className="studio-pick__check">
                            <input type="checkbox" checked={on} onChange={(e) => toggle(t.fullName, e.target.checked, t.access.change)} data-non-agent="the App Expert chooses tables with the catalog room's create-app action" />
                            <span className="studio-pick__name">{t.schema}.{t.name}</span>
                          </label>
                          <StatusPill state={t.access.change ? "live" : "neutral"}>{t.access.change ? "You may change it" : "Read only"}</StatusPill>
                          {t.comment ? <span className="studio-pick__about studio-meta">{t.comment}</span> : null}
                          {kind === "data-management" && on && t.access.change ? (
                            <span className="studio-pick__access">
                              <label><input type="checkbox" checked={picked[t.fullName] === "change"} onChange={(e) => setPicked((p) => ({ ...p, [t.fullName]: e.target.checked ? "change" : "read" }))} data-non-agent="the App Expert sets each table's access with the catalog room's create-app action" /> Change it in this app</label>
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </fieldset>
                ) : null}
              </div>
            ) : null}
            <div className="studio-new-look">
              <ChoicePicker label="How should it look?" value={lookFrom} onChange={(v: string) => setLookFrom(v as typeof lookFrom)}
                options={[{ value: "website", label: "Our website's brand" }, { value: "logo", label: "Our logo" }, { value: "kit", label: "A brand kit" }, { value: "theme", label: "A built-in theme" }]}
                agent={{ id: "new-app.look-from", description: "Where the new app's look comes from: the organisation's website, its logo, a brand kit in the library, or a built-in theme" }} />
              {lookFrom === "website" ? (
                <TextField label="Website" hint="The studio reads its colours, fonts and style, then shows three options to choose from" placeholder="www.example.com" value={website} onChange={(e: any) => setWebsite(e.target.value)}
                  agent={{ id: "new-app.website", description: "The organisation's website, whose brand the new app takes" }} />
              ) : lookFrom === "logo" ? (
                <p className="studio-meta">The app opens on its Brand and style section, where you add the logo file.</p>
              ) : lookFrom === "kit" ? (
                kits.length ? (
                  <Select label="Brand kit" value={kit} options={kits.map((k) => ({ value: k.id, label: `${k.name} (${k.option.title}, ${k.designSystem})` }))} onChange={(e: any) => setKit(e.target.value)}
                    agent={{ id: "new-app.kit", description: "The brand kit from the library the new app wears" }} />
                ) : <p className="studio-meta">No brand kits yet: one is kept when you choose a brand option for an app.</p>
              ) : (
                <Select label="Theme" value={theme} options={themes.length ? themes : [{ value: "plain", label: "Plain" }]} onChange={(e: any) => setTheme(e.target.value)}
                  agent={{ id: "new-app.theme", description: "The built-in theme the new app starts with" }} />
              )}
            </div>
            {error ? <Notice tone="error" title={error} role="alert" /> : null}
            <div>
              <Button busy={busy} onClick={create} agent={{ id: "new-app.create", description: "Create the new app from the name, use case and look, and open it (on its Brand and style section when the look comes from a website or logo)" }}>Create app</Button>
            </div>
          </Stack>
        </Card>
        ) : null}
        {apps === null ? null : apps.length === 0 ? (
          <Notice tone="info" title="No apps yet">Create one above, or tell the assistant what you need.</Notice>
        ) : (
          <Grid columns={{ compact: 1, medium: 2, expanded: 3 }} gap={4}>
            {apps.map((a) => (
              <Card key={a.id} title={a.name} actions={a.access && !a.access.edit
                ? <Button variant="secondary" onClick={() => navigate(`/run/${encodeURIComponent(a.id)}`)} agent={{ nonAgent: "using an app is the person's own; the App Expert opens apps to change them" }}>Use</Button>
                : <Button variant="secondary" onClick={() => navigate(`/apps/${encodeURIComponent(a.id)}`)} agent={{ nonAgent: "opening an app is the catalog room's open-app action" }}>Open</Button>}>
                <Stack gap={2}>
                  <p>{a.description || a.useCase || "No description yet."}</p>
                  <p className="studio-meta">
                    v{a.version} · revision {a.revision}
                    {a.variantOf ? <> · variant of {a.variantOf.id}</> : null}
                    {a.brandKit ? <> · brand kit {a.brandKit}</> : a.theme ? <> · {a.theme}</> : null}
                  </p>
                  {a.access && !a.access.mine && a.access.owner ? <p className="studio-meta">Shared with you by {a.access.owner}{a.access.edit ? ", to change" : ", to use"}</p> : null}
                  {a.variantOf ? <StatusPill state="evaluation">Variant</StatusPill> : null}
                </Stack>
              </Card>
            ))}
          </Grid>
        )}
      </Stack>
    </Page>
  );
}
