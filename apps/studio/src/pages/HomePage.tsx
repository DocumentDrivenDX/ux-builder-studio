/* The catalog: every app built here, and a way to start a new one. A person can
   type the request into the assistant instead; the assistant uses the same
   catalog room to create the app. */
import { useEffect, useState } from "react";
import { Card, Notice, StatusPill } from "@ux-builder/ui";
import { Grid, Page, PageHeader, Stack } from "@ux-builder/ui/patterns";
import { Button, ChoicePicker, Select, TextArea, TextField } from "../agent/generated/bound/ux-builder-ui";
import { api, onChange, type BrandKit, type CatalogEntry } from "../api";
import { navigate } from "../router";
import { CatalogRoom } from "../rooms/catalog/CatalogRoom";

export function HomePage() {
  const [apps, setApps] = useState<CatalogEntry[] | null>(null);
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
    return onChange(() => load());
  }, []);

  const create = async () => {
    if (!name.trim()) return setError("Give the app a name");
    if (lookFrom === "kit" && !kit) return setError("Choose a brand kit, or another way to set the look");
    setBusy(true);
    setError(null);
    try {
      const chosenKit = kits.find((k) => k.id === kit);
      const v = await api.createApp({
        name: name.trim(), useCase: useCase.trim(),
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
        <PageHeader title="Your apps" description="Describe an app to the App Expert, or start one here. Every app is a definition the studio renders: no code to write or deploy." />
        <Card title="New app">
          <Stack gap={4}>
            <TextField label="App name" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Time tracker" agent={{ id: "new-app.name", description: "The new app's name" }} />
            <TextArea label="What should it do?" hint="Who uses it, and what they need to get done" value={useCase} onChange={(e: any) => setUseCase(e.target.value)} rows={3} agent={{ id: "new-app.use-case", description: "The new app's use case, in the person's words" }} />
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
        {apps === null ? null : apps.length === 0 ? (
          <Notice tone="info" title="No apps yet">Create one above, or tell the assistant what you need.</Notice>
        ) : (
          <Grid columns={{ compact: 1, medium: 2, expanded: 3 }} gap={4}>
            {apps.map((a) => (
              <Card key={a.id} title={a.name} actions={<Button variant="secondary" onClick={() => navigate(`/apps/${encodeURIComponent(a.id)}`)} agent={{ nonAgent: "opening an app is the catalog room's open-app action" }}>Open</Button>}>
                <Stack gap={2}>
                  <p>{a.description || a.useCase || "No description yet."}</p>
                  <p className="studio-meta">
                    v{a.version} · revision {a.revision}
                    {a.variantOf ? <> · variant of {a.variantOf.id}</> : null}
                    {a.brandKit ? <> · brand kit {a.brandKit}</> : a.theme ? <> · {a.theme}</> : null}
                  </p>
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
