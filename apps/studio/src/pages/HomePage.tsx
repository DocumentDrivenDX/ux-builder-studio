/* The catalog: every app built here, and a way to start a new one. A person can
   type the request into the assistant instead; the assistant uses the same
   catalog room to create the app. */
import { useEffect, useState } from "react";
import { Card, Notice, StatusPill } from "@ux-builder/ui";
import { Grid, Page, PageHeader, Stack } from "@ux-builder/ui/patterns";
import { Button, TextArea, TextField } from "../agent/generated/bound/ux-builder-ui";
import { api, onChange, type CatalogEntry } from "../api";
import { navigate } from "../router";
import { CatalogRoom } from "../rooms/catalog/CatalogRoom";

export function HomePage() {
  const [apps, setApps] = useState<CatalogEntry[] | null>(null);
  const [name, setName] = useState("");
  const [useCase, setUseCase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => api.apps().then((r) => setApps(r.apps), (e) => setError(String(e?.message ?? e)));
    load();
    return onChange(() => load());
  }, []);

  const create = async () => {
    if (!name.trim()) return setError("Give the app a name");
    setBusy(true);
    setError(null);
    try {
      const v = await api.createApp({ name: name.trim(), useCase: useCase.trim() });
      navigate(`/apps/${encodeURIComponent(v.definition.id)}`);
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
            {error ? <Notice tone="error" title={error} role="alert" /> : null}
            <div>
              <Button busy={busy} onClick={create} agent={{ id: "new-app.create", description: "Create the new app from the name and use case, and open it" }}>Create app</Button>
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
                    {a.theme ? <> · {a.theme}</> : null}
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
