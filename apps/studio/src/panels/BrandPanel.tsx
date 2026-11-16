/* Brand and style: the up-front step that decides how an app looks.

   From a website: the studio opens it in a browser on this machine, takes a
   screenshot, reads its CSS (button, link and theme colours, brand custom
   properties, fonts, corner radius) and its logo, and finds the brand's
   colours. ux-builder's palette engine turns them into palettes fitted to
   the contrast rules; the studio shows the three that fit the brand and the
   colour rules best, on the design system whose controls look most like the
   site's, each tried on real widgets in light and dark. The one chosen is
   kept as a brand kit in the studio's library, so the next app for the same
   client starts from it. */
import { useState } from "react";
import { Card, Notice, StatusPill, ThemeProvider } from "@ux-builder/ui";
import { Cluster, ConfirmDialog, Stack } from "@ux-builder/ui/patterns";
import { Button, ChoicePicker, Select, TextField } from "../agent/generated/bound/ux-builder-ui";
import { useBrand } from "../brand/brand";
import type { BrandKit, ColourFinding, PaletteOption } from "../api";
import { useStudio } from "../studio";

const RULE_TITLES: Record<string, string> = {
  "theme.contrast": "Contrast",
  "color.red-reserved": "Red kept for errors",
  "theme.contrast-margin": "Contrast margin",
  "theme.text-tiers": "Text tiers",
  "theme.structure-accent-distinct": "Buttons and links differ",
  "theme.surface-separation": "Cards stand out",
  "theme.dark-appearance": "Own dark appearance",
};

function Swatch({ hex, label }: { hex?: string; label: string }) {
  if (!hex) return null;
  return (
    <span className="studio-swatch">
      <span className="studio-swatch__chip" style={{ background: hex }} aria-hidden="true" />
      <span>{label} <code>{hex.toLowerCase()}</code></span>
    </span>
  );
}

/* A few real widgets in the option's colours: what the app will look like. Inert: it is a sample. */
function Specimen({ option, appearance }: { option: PaletteOption; appearance: "light" | "dark" }) {
  return (
    <ThemeProvider tokens={option.tokens[appearance]} appearance={appearance} favicon={false} className="studio-brand__specimen" data-option={option.id} data-appearance-shown={appearance}>
      <div inert data-non-agent="a sample of the option's colours, not a control">
        <Stack gap={3}>
          <p className="studio-brand__specimen-title">Matters this week</p>
          <p className="studio-brand__specimen-text">Three need a decision. <a href="#sample" onClick={(e) => e.preventDefault()} data-non-agent="a sample link in the option's colours">Open the list</a></p>
          <Cluster gap={2}>
            <StatusPill state="live">On track</StatusPill>
            <StatusPill state="limited">Due soon</StatusPill>
            <StatusPill state="closed">Overdue</StatusPill>
          </Cluster>
          <TextField label="Client" value="Halvorsen" readOnly onChange={() => {}} agent={{ nonAgent: "a sample field in the option's colours" }} />
          <Cluster gap={2}>
            <Button agent={{ nonAgent: "a sample button in the option's colours" }}>Approve</Button>
            <Button variant="secondary" agent={{ nonAgent: "a sample button in the option's colours" }}>Send back</Button>
          </Cluster>
        </Stack>
      </div>
    </ThemeProvider>
  );
}

function Findings({ findings }: { findings: ColourFinding[] }) {
  if (!findings.length) return <StatusPill state="live">Meets the colour rules</StatusPill>;
  return (
    <details className="studio-brand__findings">
      <summary><StatusPill state="limited">{`${findings.length} to review`}</StatusPill></summary>
      <ul>
        {findings.map((f, i) => <li key={i}><strong>{RULE_TITLES[f.rule] ?? f.rule}</strong> ({f.appearance}): {f.message}. <span className="studio-meta">{f.rule}</span></li>)}
      </ul>
    </details>
  );
}

function OptionCard({ option, index, appearance, current, onChoose, busy }: { option: PaletteOption; index: number; appearance: "light" | "dark"; current: boolean; onChoose(): void; busy: boolean }) {
  const sw = option.swatches[appearance];
  return (
    <article className="studio-brand__option" aria-labelledby={`brand-option-${option.id}`} data-option-id={option.id}>
      <header className="studio-brand__option-head">
        <h4 id={`brand-option-${option.id}`}>{`${index + 1}. ${option.title}`}</h4>
        <Findings findings={option.findings} />
      </header>
      <p className="studio-meta">{option.description}</p>
      <Specimen option={option} appearance={appearance} />
      <div className="studio-brand__swatches">
        <Swatch hex={sw.structure} label="Buttons" />
        <Swatch hex={sw.accent} label="Links" />
        <Swatch hex={sw.ground} label="Page" />
      </div>
      <Button onClick={onChoose} busy={busy} disabled={current} agent={{ nonAgent: "choosing an option is the app room's choose-brand-option action" }}>
        {current ? "In use" : "Use this option"}
      </Button>
    </article>
  );
}

function KitRow({ kit, inUse, onApply, onRemove }: { kit: BrandKit; inUse: boolean; onApply(): void; onRemove(): void }) {
  return (
    <li className="studio-brand__kit" data-kit-id={kit.id}>
      <span className="studio-brand__kit-chips" aria-hidden="true">
        {[kit.swatches.structure, kit.swatches.accent, kit.swatches.ground].filter(Boolean).map((h, i) => <span key={i} style={{ background: h }} />)}
      </span>
      <span className="studio-brand__kit-text">
        <strong>{kit.name}</strong>
        <span className="studio-meta">{`${kit.option.title} · ${kit.designSystem}${kit.source ? ` · ${new URL(kit.source.url).hostname}` : ""}${kit.usedBy.length ? ` · used by ${kit.usedBy.map((a) => a.name).join(", ")}` : ""}`}</span>
      </span>
      <Cluster gap={2}>
        {inUse ? <StatusPill state="live">In use</StatusPill> : <Button size="sm" variant="secondary" onClick={onApply} agent={{ nonAgent: "using a kit is the app room's apply-brand-kit action" }}>Use</Button>}
        <a className="studio-link" href={`/api/brand/kits/${encodeURIComponent(kit.id)}/tokens.json`} download data-non-agent="downloads the kit as a file for the person">Download tokens</a>
        {!kit.usedBy.length ? <Button size="sm" variant="text" onClick={onRemove} agent={{ nonAgent: "removing a kit from the library is a person's decision" }}>Remove</Button> : null}
      </Cluster>
    </li>
  );
}

export function BrandPanel() {
  const s = useStudio();
  const b = useBrand();
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<BrandKit | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const look = s.view?.definition.extensions?.["umf.ux"]?.look ?? { theme: "plain" };
  const c = b.capture;

  const report = (r: { ok: boolean; message?: string }) => setProblem(r.ok ? null : (r as any).message ?? "Something went wrong");

  return (
    <Stack gap={5}>
      <section aria-labelledby="brand-now" className="studio-brand__now">
        <h3 id="brand-now">The app's look now</h3>
        {b.current ? (
          <Cluster gap={3} align="center">
            <span>{`Brand kit ${b.current.name} (${b.current.option.title}, ${b.current.designSystem} style)`}</span>
            <Button size="sm" variant="secondary" onClick={async () => report(await b.stopUsingKit())} agent={{ id: "brand.stop-kit", description: "Stop using the brand kit; the app shows its theme again" }}>Use the theme instead</Button>
          </Cluster>
        ) : (
          <p>{`The built-in theme ${look.theme}. Read your organisation's website below to dress the app in its brand, or use a kit from the library.`}</p>
        )}
      </section>

      <section aria-labelledby="brand-from-site">
        <h3 id="brand-from-site">Brand from a website</h3>
        <p className="studio-meta">The studio opens the site on this computer, takes a screenshot, and reads its colours, fonts and button style from the page and its CSS. Nothing is sent anywhere else.</p>
        <form className="studio-brand__form" data-non-agent="submitting is the brand.capture button, or the app room's capture-brand action" onSubmit={async (e) => { e.preventDefault(); await b.captureFromUrl(); }}>
          <TextField label="Website" placeholder="www.example.com" value={b.url} onChange={(e: any) => b.setUrl(e.target.value)}
            agent={{ id: "brand.url", description: "The website whose brand to read, such as the organisation's home page" }} />
          <Button type="submit" busy={b.busy === "capturing"} agent={{ id: "brand.capture", description: "Read the website's brand: screenshot, colours, fonts and style, then show three palette options" }}>
            {b.busy === "capturing" ? "Reading the site…" : "Get brand"}
          </Button>
        </form>
        {b.error ? <Notice tone="error" title="Could not read that site">{b.error}</Notice> : null}
      </section>

      {c ? (
        <section aria-labelledby="brand-found" className="studio-brand__found">
          <h3 id="brand-found">{`What ${c.name} looks like`}</h3>
          <div className="studio-brand__evidence">
            <figure className="studio-brand__shot">
              <img src={c.screenshot} alt={`Screenshot of ${c.title}`} />
              <figcaption className="studio-meta"><a className="studio-link" href={c.finalUrl} target="_blank" rel="noreferrer" data-non-agent="opens the website itself">{c.finalUrl}</a></figcaption>
            </figure>
            <Card title="Found on the site">
              <Stack gap={3}>
                {c.logo ? <img className="studio-brand__logo" src={c.logo} alt={`${c.name} logo, as found on the site`} /> : null}
                <ul className="studio-brand__colours">
                  {c.analysis.colours.length ? c.analysis.colours.map((col) => (
                    <li key={col.hex}><Swatch hex={col.hex} label={`${Math.round(col.share * 100)}%`} /><span className="studio-meta">{col.sources.map((x) => x.label).join(", ")}</span></li>
                  )) : <li>No brand colour: only black, white and greys.</li>}
                </ul>
                <p>{`Text font: ${c.analysis.fonts.body}${c.analysis.fonts.heading && c.analysis.fonts.heading !== c.analysis.fonts.body ? `; headings: ${c.analysis.fonts.heading}` : ""}`}</p>
                <p>{c.analysis.style.reason}</p>
              </Stack>
            </Card>
          </div>
          {c.notes.length ? <Notice tone="info" title="Good to know">{c.notes.map((n, i) => <p key={i}>{n}</p>)}</Notice> : null}

          <h3>Three options</h3>
          <Cluster gap={4} align="end">
            <Select label="Style (design system)" value={c.designSystem} options={b.designSystems.map((d) => ({ value: d.name, label: `${d.title}: ${d.summary}` }))}
              onChange={async (e: any) => report(await b.setDesignSystem(e.target.value))}
              agent={{ id: "brand.design-system", description: "The design system the options are shown on: control shapes, density and fonts (Databricks, Material, Fluent or Carbon)" }} />
            <ChoicePicker label="Show in" value={appearance} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(v: string) => setAppearance(v as "light" | "dark")}
              agent={{ id: "brand.preview-appearance", description: "Whether the options are shown in light or dark" }} />
            <TextField label="Kit name" placeholder={c.name} value={name} onChange={(e: any) => setName(e.target.value)}
              agent={{ id: "brand.kit-name", description: "The name the chosen option is kept under in the brand kit library" }} />
          </Cluster>
          <div className="studio-brand__options" aria-busy={b.busy === "options" || undefined}>
            {c.options.map((o, i) => (
              <OptionCard key={`${c.designSystem}:${o.id}`} option={o} index={i} appearance={appearance} busy={b.busy === "saving"}
                current={!!b.current && b.current.source?.captureId === c.id && b.current.option.id === o.id && b.current.designSystem === c.designSystem}
                onChoose={async () => report(await b.chooseOption(o.id, name))} />
            ))}
          </div>
        </section>
      ) : null}
      {problem ? <Notice tone="error" title={problem} /> : null}

      <section aria-labelledby="brand-kits">
        <h3 id="brand-kits">Brand kit library</h3>
        {b.kits.length ? (
          <ul className="studio-brand__kits">
            {b.kits.map((k) => <KitRow key={k.id} kit={k} inUse={b.current?.id === k.id} onApply={async () => report(await b.applyKit(k.id))} onRemove={() => setRemoving(k)} />)}
          </ul>
        ) : <p className="studio-meta">No kits yet. A kit is kept here when you choose an option, and any app in the studio can use it.</p>}
      </section>

      <ConfirmDialog
        open={!!removing}
        title="Remove this brand kit?"
        objectName={removing?.name ?? ""}
        consequence="It is removed from the library. No app uses it, so no app changes."
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => { const k = removing; setRemoving(null); if (k) report(await b.removeKit(k.id)); }}
        data-non-agent="removing a kit is a person's decision"
      />
    </Stack>
  );
}
