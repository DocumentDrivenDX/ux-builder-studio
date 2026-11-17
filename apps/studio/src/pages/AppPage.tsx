/* The builder: the app's configuration and its live preview, as two tabs, so
   each has the whole width. The preview is the app itself (rendered from its
   definition by @ux-builder/app-runtime, on the Postgres tables UMF deployed),
   signed in as one of its sample people. */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Dialog, Notice, StatusPill, registerIcons } from "@ux-builder/ui";
import { iconDatabase, iconHistory, iconInfo, iconListChecks, iconNetwork, iconPalette, iconPanelsTopLeft, iconServer, iconZap } from "@ux-builder/ui/icons";
import { Cluster, ConfirmDialog, Page, PageHeader, PrimaryNav, Stack } from "@ux-builder/ui/patterns";
import { AppView } from "@ux-builder/app-runtime";
import { Button, ChoicePicker, Select, Tabs, TextField } from "../agent/generated/bound/ux-builder-ui";
import { api, httpClient } from "../api";
import { useParams } from "../router";
import { AppRoom } from "../rooms/app/AppRoom";
import { ActionsPanel, DataPanel, DeploymentPanel, OverviewPanel, RulesPanel, ScreensPanel, VersionsPanel } from "../panels/Panels";
import { DiagramsPanel } from "../panels/DiagramsPanel";
import { BrandPanel } from "../panels/BrandPanel";
import { BrandProvider, useBrand, useKitTokens } from "../brand/brand";
import { BUILDER_TABS, PANELS, StudioProvider, useStudio, type BuilderTab, type Panel } from "../studio";
import { ShareDialog } from "../components/ShareDialog";
import { navigate } from "../router";

export function AppPage() {
  const { appId } = useParams();
  return (
    <StudioProvider appId={appId}>
      <BrandProvider>
        <StartFromLink />
        <AppRoom />
        <Builder />
      </BrandProvider>
    </StudioProvider>
  );
}

/* A link into the builder may ask for a section and a brand to read first:
   ?panel=brand&brand=<website> (the New app form's "Our website's brand").
   It is acted on once, then dropped from the address. */
function StartFromLink() {
  const s = useStudio();
  const b = useBrand();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !s.view) return;
    done.current = true;
    const q = new URLSearchParams(window.location.search);
    const panel = q.get("panel"), site = q.get("brand");
    if (!panel && !site) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (panel && PANELS.some((p) => p.id === panel)) s.setPanel(panel as Panel);
    if (site) void b.captureFromUrl(site);
  }, [s.view, s, b]);
  return null;
}

registerIcons(iconInfo, iconPalette, iconDatabase, iconPanelsTopLeft, iconZap, iconNetwork, iconListChecks, iconHistory, iconServer);
const PANEL_ICONS: Record<Panel, string> = { overview: "info", brand: "palette", data: "database", screens: "panels-top-left", actions: "zap", diagrams: "network", rules: "list-checks", versions: "history", deployment: "server" };

const APPEARANCES = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Builder() {
  const s = useStudio();
  const brand = useBrand();
  const [themes, setThemes] = useState<Array<{ value: string; label: string }>>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [variantName, setVariantName] = useState("");
  const [variantNote, setVariantNote] = useState("");
  const [lookError, setLookError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    api.themes().then((r) => setThemes(r.themes.map((t) => ({ value: t.name, label: t.title }))));
  }, []);

  // Someone who may only use the app uses it; the builder is for those who may change it.
  const readOnly = !!s.view?.access && !s.view.access.edit;
  useEffect(() => { if (readOnly) navigate(`/run/${encodeURIComponent(s.appId)}`); }, [readOnly, s.appId]);

  const client = useMemo(() => (s.person ? httpClient(s.appId, s.person) : null), [s.appId, s.person?.id]);
  const kitTokens = useKitTokens(s.view?.definition.extensions?.["umf.ux"]?.look?.brandKit);

  if (s.error) return <Page><Notice tone="error" title="Could not open this app">{s.error}</Notice></Page>;
  if (!s.view) return <Page><p className="studio-meta">Opening…</p></Page>;
  if (s.view.access && !s.view.access.edit) return null;

  const def = s.view.definition;
  const app = def.extensions["umf.app"];
  const look = def.extensions["umf.ux"].look;
  const problems = s.view.verdict.errors.length;
  const warnings = s.view.verdict.warnings.length;

  const setLook = async (args: Record<string, string>, summary: string) => {
    const r = await s.apply([{ op: "setLook", args }], summary);
    setLookError(r.ok ? null : r.message);
  };

  const panels: Record<Panel, ReactElement> = {
    overview: <OverviewPanel />,
    brand: <BrandPanel />,
    data: <DataPanel />,
    screens: <ScreensPanel />,
    actions: <ActionsPanel />,
    rules: <RulesPanel />,
    versions: <VersionsPanel />,
    diagrams: <DiagramsPanel />,
    deployment: <DeploymentPanel />,
  };

  // The configuration sections as a nav beside the one shown; only the section scrolls.
  const rulesCount = problems + warnings;
  const configuration = (
    <div className="builder__config">
      <PrimaryNav
        className="builder__config-nav"
        label="Configuration sections"
        current={s.panel}
        items={PANELS.map((p) => ({ id: p.id, label: p.id === "rules" && rulesCount ? `${p.label} (${rulesCount})` : p.label, href: `?panel=${p.id}`, icon: PANEL_ICONS[p.id] }))}
        onNavigate={(item: { id: string }) => s.setPanel(item.id as Panel)}
        data-non-agent="the sections are the app room's show-panel action"
      />
      <section key={s.panel} className="builder__config-section" aria-labelledby="builder-section-title">
        <h2 id="builder-section-title" className="builder__section-title">{PANELS.find((p) => p.id === s.panel)?.label}</h2>
        {panels[s.panel]}
      </section>
    </div>
  );

  // The preview stays mounted while the configuration tab is shown, so it keeps its screen and data.
  const preview = (
    <section className="builder__preview" aria-label="Live preview">
      <div className="builder__toolbar">
        <Cluster gap={3} align="end">
          <Select
            label={s.live ? "Previewing as" : "Signed in as"}
            value={s.person?.id ?? ""}
            options={s.people.map((p) => ({ value: p.id, label: `${p.name} (${p.roles.join(", ") || "no role"})` }))}
            placeholder={s.people.length ? undefined : "No sample people yet"}
            onChange={(e: any) => s.setPerson(e.target.value)}
            agent={{ id: "preview.person", description: "Which sample person the live preview is signed in as" }}
          />
          {look.brandKit ? (
            <p className="studio-meta builder__kit">
              {`Brand kit: ${brand.current?.name ?? look.brandKit}`}{" "}
              <a className="studio-link" href="?panel=brand" onClick={(e) => { e.preventDefault(); s.setPanel("brand"); }} data-non-agent="the Brand and style panel is the app room's show-panel action">Change</a>
            </p>
          ) : (
            <Select
              label="Theme"
              value={look.theme}
              options={themes.length ? themes : [{ value: look.theme, label: look.theme }]}
              onChange={(e: any) => setLook({ theme: e.target.value }, `Theme ${e.target.value}`)}
              agent={{ id: "look.theme", description: "The app's built-in theme (brand and design system), when it uses no brand kit" }}
            />
          )}
          <ChoicePicker
            label="Appearance"
            value={look.appearance ?? "system"}
            options={APPEARANCES}
            onChange={(v: string) => setLook({ appearance: v }, `${v} appearance`)}
            agent={{ id: "look.appearance", description: "The app's default appearance: automatic, light or dark" }}
          />
          {s.view.definition.extensions?.["umf.app"]?.samples?.records?.length ? (
            <Button variant="secondary" onClick={() => setConfirmReset(true)} agent={{ id: "preview.reset", description: "Reset the preview's data to the app's sample data (asks first)" }}>Reset sample data</Button>
          ) : null}
        </Cluster>
        {s.live ? <p className="studio-meta builder__live">Live data from the data catalog, read as you: you see only what the catalog lets you see. Trying a role changes what the app shows, not what the catalog lets you see or change.</p> : null}
        {lookError ? <Notice tone="error" title={lookError} /> : null}
      </div>
      <div className="builder__frame">
        {!s.view.verdict.renderable ? (
          <Notice tone="error" title="This version cannot render">Open App configuration, then Rules, to see what to fix.</Notice>
        ) : client ? (
          <AppView key={`${def.id}:${s.view.version}:${s.person?.id}`} definition={def} client={client} tokens={kitTokens} location={s.location} onLocationChange={s.setLocation} adapt="container" data-non-agent="the preview is the app itself; the agent drives it through the app room's set-preview action" />
        ) : (
          <Notice tone="info" title="Add sample people to preview the app">The preview signs in as one of the app's sample people.</Notice>
        )}
      </div>
    </section>
  );

  return (
    <div className="builder">
      <header className="builder__head">
        <PageHeader
          title={app.name}
          status={problems ? <StatusPill state="closed">{`${problems} problem${problems === 1 ? "" : "s"}`}</StatusPill> : warnings ? <StatusPill state="limited">{`${warnings} to review`}</StatusPill> : <StatusPill state="live">Valid</StatusPill>}
          description={app.description || app.useCase || "Tell the App Expert what this app is for to start building it."}
          actions={<Cluster gap={2}>
            {s.view.access?.share ? <Button variant="secondary" onClick={() => setShareOpen(true)} agent={{ id: "builder.share", description: "Open the sharing dialog: who may use or change this app" }}>Share</Button> : null}
            <Button variant="secondary" onClick={() => { setVariantName(`${app.name} variant`); setVariantOpen(true); }} agent={{ id: "builder.variant", description: "Start creating a variant of this app (asks for its name)" }}>Create variant</Button>
          </Cluster>}
          secondaryActions={<a className="studio-link" href={`/run/${encodeURIComponent(def.id)}`} target="_blank" rel="noreferrer">Open the app</a>}
        />
      </header>
      <Tabs
        className="builder__tabs"
        label="Builder"
        value={s.tab}
        onChange={(id: string) => s.setTab(id as BuilderTab)}
        tabs={BUILDER_TABS.map((t) => ({ id: t.id, label: t.label, panel: t.id === "configuration" ? configuration : preview }))}
        agent={{ id: "builder.tab", description: "Which builder tab is shown: App configuration (the app's panels) or App preview (the live app)" }}
      />
      <ShareDialog appId={s.appId} appName={app.name} open={shareOpen} onClose={() => setShareOpen(false)} />
      <ConfirmDialog
        open={confirmReset}
        title="Reset the sample data?"
        objectName="the preview's changes"
        consequence="Every change made in the preview is thrown away and the app's sample data is loaded again."
        confirmLabel="Reset"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => { setConfirmReset(false); await s.reset(); }}
        data-non-agent="resetting is the app room's reset-data action, which asks the person to approve"
      />
      <Dialog
        open={variantOpen}
        onClose={() => setVariantOpen(false)}
        title="Create a variant"
        description="A copy of this app in the catalog, recorded as a variant of it. This app does not change."
        data-non-agent="variants are the app room's create-variant action"
        actions={
          <>
            <Button onClick={async () => { const r = await s.variant(variantName, variantNote); if (r.ok) setVariantOpen(false); else setLookError(r.message ?? "Could not create the variant"); }} agent={{ id: "variant.create", description: "Create the variant with this name and note" }}>Create variant</Button>
            <Button variant="secondary" onClick={() => setVariantOpen(false)} agent={{ id: "variant.cancel", description: "Close without creating a variant" }}>Cancel</Button>
          </>
        }
      >
        <Stack gap={3}>
          {lookError && variantOpen ? <Notice tone="error" title={lookError} /> : null}
          <TextField label="Name" value={variantName} onChange={(e: any) => setVariantName(e.target.value)} agent={{ id: "variant.name", description: "The variant's name" }} />
          <TextField label="What differs" value={variantNote} onChange={(e: any) => setVariantNote(e.target.value)} agent={{ id: "variant.note", description: "What the variant changes" }} />
        </Stack>
      </Dialog>
    </div>
  );
}
