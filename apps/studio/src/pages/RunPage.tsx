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
import { previewPeople } from "../studio";
import { useSession } from "../session";

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
  const { me } = useSession();
  const live = !!(view?.definition.extensions?.["umf.app"]?.sources ?? []).length;
  const people: Identity[] = useMemo(() => previewPeople(view, me), [view, me]);
  const person = people.find((p) => p.id === personId) ?? people[0];
  const client = useMemo(() => (person ? httpClient(appId, person) : null), [appId, person]);
  const kitTokens = useKitTokens(view?.definition.extensions?.["umf.ux"]?.look?.brandKit);
  if (error) return <Page><Notice tone="error" title="Could not open this app">{error}</Notice></Page>;
  if (view && (!client || (live && !person?.roles.length))) return <Page><Notice tone="info" title={live ? "You have no role in this app" : "This app has no people to sign in as yet"}>{live ? "Ask its owner to give one of your groups a role." : "The App Expert adds sample people as it builds the app."}</Notice></Page>;
  if (!view || !client) return <Page><p className="studio-meta">Opening…</p></Page>;
  return (
    <div className="run">
      <div className="run__bar">
        <Select label={live ? "Using it as" : "Signed in as (sample person)"} value={person?.id} options={people.map((p) => ({ value: p.id, label: `${p.name} (${p.roles.join(", ")})` }))} onChange={(e: any) => setPersonId(e.target.value)} agent={{ id: "run.person", description: "Which sample person the app is signed in as" }} />
      </div>
      <AppView key={`${view.version}:${person?.id}`} definition={view.definition} client={client} tokens={kitTokens} data-non-agent="the app is operated by its own people here; the studio's agent works in the builder" />
    </div>
  );
}
