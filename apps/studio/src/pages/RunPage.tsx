/* The app on its own, as its people would use it: full page, no builder. */
import { useEffect, useMemo, useState } from "react";
import { Notice } from "@ux-builder/ui";
import { Page } from "@ux-builder/ui/patterns";
import { AppView } from "@ux-builder/app-runtime";
import type { Identity } from "@ux-builder/app-runtime/contract";
import { Select } from "../agent/generated/bound/ux-builder-ui";
import { api, httpClient, onChange, type AppView as View } from "../api";
import { useParams } from "../router";
import { useKitTokens } from "../brand/brand";

export function RunPage() {
  const { appId } = useParams();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.app(appId).then(setView, (e) => setError(String(e?.body?.message ?? e?.message ?? e)));
    load();
    return onChange((e) => { if (e.appId === appId && e.kind === "definition") load(); });
  }, [appId]);
  const people: Identity[] = view?.definition.extensions?.["umf.app"]?.samples?.identities ?? [];
  const person = people.find((p) => p.id === personId) ?? people[0];
  const client = useMemo(() => (person ? httpClient(appId, person) : null), [appId, person]);
  const kitTokens = useKitTokens(view?.definition.extensions?.["umf.ux"]?.look?.brandKit);
  if (error) return <Page><Notice tone="error" title="Could not open this app">{error}</Notice></Page>;
  if (!view || !client) return <Page><p className="studio-meta">Opening…</p></Page>;
  return (
    <div className="run">
      <div className="run__bar">
        <Select label="Signed in as (sample person)" value={person?.id} options={people.map((p) => ({ value: p.id, label: `${p.name} (${p.roles.join(", ")})` }))} onChange={(e: any) => setPersonId(e.target.value)} agent={{ id: "run.person", description: "Which sample person the app is signed in as" }} />
      </div>
      <AppView key={`${view.version}:${person?.id}`} definition={view.definition} client={client} tokens={kitTokens} data-non-agent="the app is operated by its own people here; the studio's agent works in the builder" />
    </div>
  );
}
