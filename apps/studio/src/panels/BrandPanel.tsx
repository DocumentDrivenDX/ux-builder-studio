/* Brand and style: the up-front step that decides how an app looks.

   1. Source: the organisation's website (the studio opens it in a browser on
      this machine, screenshots it, reads its CSS and its logo) or a logo
      file.
   2. What was found: the brand's colours with where each was seen, fonts,
      and the style its buttons suggest.
   3. Style: the design system (Databricks, Material, Fluent, Carbon), each
      with what it settles of ux-builder's theme rules.
   4. Three palette options from ux-builder's palette engine, fitted to the
      contrast margin and checked against the colour rules, each tried on
      real widgets in light and dark.
   5. Adjust: an option that is not quite right is made again with changed
      settings (hue, strength, tint, page lightness), never by picking
      colours by hand, so it still passes the rules.
   6. Keep: the chosen option becomes a brand kit in the studio's library,
      shared by every app; the app wears it at once. */
import { useState } from "react";
import { Card, Notice, StatusPill, ThemeProvider } from "@ux-builder/ui";
import { Cluster, ConfirmDialog, Stack } from "@ux-builder/ui/patterns";
import { Button, ChoicePicker, Select, TextField } from "../agent/generated/bound/ux-builder-ui";
import { useBrand, type Appearance } from "../brand/brand";
import type { AdjustRange, BrandKit, ColourFinding, PaletteOption } from "../api";
import { useStudio } from "../studio";

const APPEARANCES = [{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }];
const sourceOf = (kit: BrandKit) => !kit.source ? "" : kit.source.url.startsWith("file:") ? " · from a logo" : ` · ${new URL(kit.source.url).hostname}`;

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

function Findings({ findings, ok = "Meets the colour rules" }: { findings: ColourFinding[]; ok?: string }) {
  if (!findings.length) return <StatusPill state="live">{ok}</StatusPill>;
  return (
    <details className="studio-brand__findings">
      <summary><StatusPill state="limited">{`${findings.length} to review`}</StatusPill></summary>
      <FindingList findings={findings} />
    </details>
  );
}
const FindingList = ({ findings }: { findings: ColourFinding[] }) => (
  <ul className="studio-brand__finding-list">
    {findings.map((f, i) => <li key={i}><strong>{f.title}</strong>{f.appearance === "both" ? "" : ` (${f.appearance})`}: {f.message.replace(/\.$/, "")}. <span className="studio-meta">{f.rule}</span></li>)}
  </ul>
);

/* The engine's settings for one option, as sliders; applying makes the option again. */
function Adjust({ option, ranges, busy, onApply, onReset }: { option: PaletteOption; ranges: AdjustRange[]; busy: boolean; onApply(v: Record<string, number>): void; onReset(): void }) {
  const [draft, setDraft] = useState<Record<string, number>>(option.settings);
  const [shown, setShown] = useState(option.settings);
  if (shown !== option.settings) { setShown(option.settings); setDraft(option.settings); }
  const changed = ranges.filter((r) => draft[r.name] !== option.settings[r.name]);
  return (
    <details className="studio-brand__adjust" open={!!option.adjusted || undefined}>
      <summary>Adjust this option</summary>
      <p className="studio-meta">The engine makes the option again with these settings, so it still meets the contrast rules. Or tell the App Expert, for example "a bit darker and less saturated".</p>
      <div className="studio-brand__sliders" data-non-agent="adjusting is the app room's adjust-brand-option action">
        {ranges.map((r) => (
          <label key={r.name} className="studio-brand__slider">
            <span>{r.label} <code>{Number(draft[r.name]).toFixed(r.step >= 1 ? 0 : 2)}</code></span>
            <input type="range" data-non-agent="adjusting is the app room's adjust-brand-option action" min={r.min} max={r.max} step={r.step} value={draft[r.name] ?? r.default} aria-label={`${r.label} for ${option.title}`}
              onChange={(e) => setDraft({ ...draft, [r.name]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <Cluster gap={2}>
        <Button size="sm" variant="secondary" busy={busy} disabled={!changed.length} onClick={() => onApply(Object.fromEntries(changed.map((r) => [r.name, draft[r.name]])))} agent={{ nonAgent: "adjusting is the app room's adjust-brand-option action" }}>Try these settings</Button>
        {option.adjusted ? <Button size="sm" variant="text" onClick={onReset} agent={{ nonAgent: "undoing an adjustment is a person's choice in the panel" }}>Back to the original</Button> : null}
      </Cluster>
    </details>
  );
}

function OptionCard({ option, index, appearance, current, ranges, busy, onChoose, onAdjust, onReset }: { option: PaletteOption; index: number; appearance: "light" | "dark"; current: boolean; ranges: AdjustRange[]; busy: string | null; onChoose(): void; onAdjust(v: Record<string, number>): void; onReset(): void }) {
  const sw = option.swatches[appearance];
  return (
    <article className="studio-brand__option" aria-labelledby={`brand-option-${option.id}`} data-option-id={option.id} data-adjusted={option.adjusted ? "" : undefined}>
      <header className="studio-brand__option-head">
        <h4 id={`brand-option-${option.id}`}>{`${index + 1}. ${option.title}`}</h4>
        <Cluster gap={2}>
          {option.adjusted ? <StatusPill state="evaluation">Adjusted</StatusPill> : null}
          <Findings findings={option.findings} />
        </Cluster>
      </header>
      <p className="studio-meta">{option.description}</p>
      <Specimen option={option} appearance={appearance} />
      <div className="studio-brand__swatches">
        <Swatch hex={sw.structure} label="Buttons" />
        <Swatch hex={sw.accent} label="Links" />
        <Swatch hex={sw.ground} label="Page" />
      </div>
      <Adjust option={option} ranges={ranges} busy={busy === "adjusting"} onApply={onAdjust} onReset={onReset} />
      <Button onClick={onChoose} busy={busy === "saving"} disabled={current} agent={{ nonAgent: "choosing an option is the app room's choose-brand-option action" }}>
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
        <span className="studio-meta">{`${kit.option.title}${kit.option.adjusted ? " (adjusted)" : ""} · ${kit.designSystem}${sourceOf(kit)}${kit.usedBy.length ? ` · used by ${kit.usedBy.map((a) => a.name).join(", ")}` : ""}`}</span>
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
  const [shownIn, setShownIn] = useState<"light" | "dark">("light");
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<BrandKit | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const look = s.view?.definition.extensions?.["umf.ux"]?.look ?? { theme: "plain" };
  const c = b.capture;
  const style = c?.styles.find((x) => x.name === c.designSystem);

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
          <p>{`The built-in theme ${look.theme}. Bring in the organisation's brand from its website or its logo below, or use a kit from the library.`}</p>
        )}
      </section>

      <section aria-labelledby="brand-source">
        <h3 id="brand-source">1. Where the brand comes from</h3>
        <p className="studio-meta">The studio opens the website on this computer, takes a screenshot, and reads its colours, fonts and button style from the page and its CSS. Nothing is sent anywhere else.</p>
        <form className="studio-brand__form" data-non-agent="submitting is the brand.capture button, or the app room's capture-brand action" onSubmit={async (e) => { e.preventDefault(); await b.captureFromUrl(); }}>
          <TextField label="Website" placeholder="www.example.com" value={b.url} onChange={(e: any) => b.setUrl(e.target.value)}
            agent={{ id: "brand.url", description: "The website whose brand to read, such as the organisation's home page" }} />
          <Button type="submit" busy={b.busy === "capturing"} agent={{ id: "brand.capture", description: "Read the website's brand: screenshot, colours, fonts and style, then show three palette options" }}>
            {b.busy === "capturing" ? "Reading…" : "Get brand"}
          </Button>
        </form>
        <label className="studio-brand__file" data-non-agent="a logo file is the person's to give">
          <span>Or start from a logo file (SVG or PNG)</span>
          <input type="file" data-non-agent="a logo file is the person's to give" accept=".svg,.png,image/svg+xml,image/png" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await b.captureFromLogo(f); e.target.value = ""; }} />
        </label>
        {b.error ? <Notice tone="error" title="Could not read the brand">{b.error}</Notice> : null}
      </section>

      {c ? (
        <section aria-labelledby="brand-found" className="studio-brand__found">
          <h3 id="brand-found">{`2. What ${c.name} looks like`}</h3>
          <div className="studio-brand__evidence" data-source={c.source}>
            {c.screenshot ? (
              <figure className="studio-brand__shot">
                <img src={c.screenshot} alt={`Screenshot of ${c.title}`} />
                <figcaption className="studio-meta"><a className="studio-link" href={c.finalUrl} target="_blank" rel="noreferrer" data-non-agent="opens the website itself">{c.finalUrl}</a></figcaption>
              </figure>
            ) : null}
            <Card title={c.source === "logo" ? "Found in the logo" : "Found on the site"}>
              <Stack gap={3}>
                {c.logo ? <img className="studio-brand__logo" src={c.logo} alt={`${c.name} logo`} /> : null}
                <ul className="studio-brand__colours">
                  {c.analysis.colours.length ? c.analysis.colours.map((col) => (
                    <li key={col.hex}><Swatch hex={col.hex} label={`${Math.round(col.share * 100)}%`} /><span className="studio-meta">{col.sources.map((x) => x.label).join(", ")}</span></li>
                  )) : <li>No brand colour: only black, white and greys.</li>}
                </ul>
                {c.analysis.fonts.body ? <p className="studio-brand__fact">{`Text font: ${c.analysis.fonts.body}${c.analysis.fonts.heading && c.analysis.fonts.heading !== c.analysis.fonts.body ? `; headings: ${c.analysis.fonts.heading}` : ""}`}</p> : null}
                <p className="studio-brand__fact">{c.analysis.style.reason}</p>
              </Stack>
            </Card>
          </div>
          {c.notes.length ? <Notice tone="info" title="Good to know">{c.notes.map((n, i) => <span key={i} className="studio-brand__note">{n}</span>)}</Notice> : null}

          <h3>3. Style</h3>
          <Cluster gap={4} align="end">
            <Select label="Style (design system)" value={c.designSystem}
              options={c.styles.map((d) => ({ value: d.name, label: `${d.title}: ${d.summary}${d.name === c.analysis.style.designSystem ? " (suggested)" : ""}${d.findings.length ? ` · ${d.findings.length} to review` : ""}` }))}
              onChange={async (e: any) => report(await b.setDesignSystem(e.target.value))}
              agent={{ id: "brand.design-system", description: "The design system the app is built on: control shapes, density and fonts (Databricks, Material, Fluent or Carbon)" }} />
            <ChoicePicker label="The app's default appearance" value={b.appearance} options={APPEARANCES} onChange={(v: string) => b.setAppearance(v as Appearance)}
              agent={{ id: "brand.appearance", description: "The appearance the app opens in once an option is chosen: automatic (the person's setting), light or dark" }} />
          </Cluster>
          {style ? (
            <div className="studio-brand__style" data-style={style.name}>
              <Findings findings={style.findings} ok={`${style.title} meets the style rules`} />
            </div>
          ) : null}

          <h3>4. Three options</h3>
          <Cluster gap={4} align="end">
            <ChoicePicker label="Show in" value={shownIn} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(v: string) => setShownIn(v as "light" | "dark")}
              agent={{ id: "brand.preview-appearance", description: "Whether the options are shown in light or dark" }} />
            <TextField label="Kit name" placeholder={c.name} value={name} onChange={(e: any) => setName(e.target.value)}
              agent={{ id: "brand.kit-name", description: "The name the chosen option is kept under in the brand kit library" }} />
          </Cluster>
          <div className="studio-brand__options" aria-busy={b.busy === "options" || b.busy === "adjusting" || undefined}>
            {b.options.map((o, i) => (
              <OptionCard key={`${c.designSystem}:${o.id}`} option={o} index={i} appearance={shownIn} busy={b.busy} ranges={c.adjustable}
                current={!!b.current && b.current.source?.captureId === c.id && b.current.option.id === o.id && b.current.designSystem === c.designSystem && JSON.stringify(b.current.option.adjusted ?? {}) === JSON.stringify(o.adjusted ?? {})}
                onChoose={async () => report(await b.chooseOption(o.id, name))}
                onAdjust={async (v) => report(await b.adjustOption(o.id, v))}
                onReset={() => b.resetOption(o.id)} />
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
