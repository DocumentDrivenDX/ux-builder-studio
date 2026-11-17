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
   5. Adjust: an option that is not quite right is made again, live as its
      sliders move, with changed settings (hue, strength, tint, page
      lightness), never by picking colours by hand, so it still passes the
      rules; Reset puts it back as offered. Open larger shows one option big,
      light and dark side by side, with the same sliders.
   6. Keep: the chosen option becomes a brand kit in the studio's library,
      shared by every app; the app wears it at once. */
import { useState } from "react";
import { Card, Dialog, Notice, StatusPill, ThemeProvider } from "@ux-builder/ui";
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

/* A few real widgets in the option's colours: what the app will look like. Inert: it is a sample. Large adds a fuller screen for the larger view. */
function Specimen({ option, appearance, large = false }: { option: PaletteOption; appearance: "light" | "dark"; large?: boolean }) {
  return (
    <ThemeProvider tokens={option.tokens[appearance]} appearance={appearance} favicon={false} className={`studio-brand__specimen${large ? " studio-brand__specimen--large" : ""}`} data-option={option.id} data-appearance-shown={appearance}>
      <div inert data-non-agent="a sample of the option's colours, not a control">
        <Stack gap={3}>
          <p className="studio-brand__specimen-title">Matters this week</p>
          <p className="studio-brand__specimen-text">Three need a decision. <a href="#sample" onClick={(e) => e.preventDefault()} data-non-agent="a sample link in the option's colours">Open the list</a></p>
          <Cluster gap={2}>
            <StatusPill state="live">On track</StatusPill>
            <StatusPill state="limited">Due soon</StatusPill>
            <StatusPill state="closed">Overdue</StatusPill>
          </Cluster>
          {large ? (
            <Card title="Halvorsen v. Marsh">
              <Stack gap={2}>
                <p className="studio-brand__specimen-text">Discovery closes Friday. Two exhibits still need review.</p>
                <Notice tone="info" title="Hearing moved to 10:30" />
                <Notice tone="error" title="One invoice is missing its receipt" />
              </Stack>
            </Card>
          ) : null}
          <TextField label="Client" value="Halvorsen" readOnly onChange={() => {}} agent={{ nonAgent: "a sample field in the option's colours" }} />
          <Cluster gap={2}>
            <Button agent={{ nonAgent: "a sample button in the option's colours" }}>Approve</Button>
            <Button variant="secondary" agent={{ nonAgent: "a sample button in the option's colours" }}>Send back</Button>
            {large ? <Button variant="text" agent={{ nonAgent: "a sample button in the option's colours" }}>Add a note</Button> : null}
          </Cluster>
        </Stack>
      </div>
    </ThemeProvider>
  );
}

/* What the findings are: ux-builder's proposed theme and colour rules, measured here. */
const FINDINGS_ABOUT = {
  option: "These are ux-builder's theme and colour rules (most of them still proposed in its rules catalog), measured on this option in light and dark. Items to review don't stop you using it: an option that broke contrast or put red on buttons and links would not be offered.",
  style: "These are ux-builder's proposed theme rules, measured on this style. They come from the design system itself (its focus ring, shadows and type), not from the brand's colours, so they are fixed in ux-builder's design-system tokens. They don't stop you using it.",
};

function Findings({ findings, ok = "Meets the colour rules", about }: { findings: ColourFinding[]; ok?: string; about: keyof typeof FINDINGS_ABOUT }) {
  if (!findings.length) return <StatusPill state="live">{ok}</StatusPill>;
  return (
    <details className="studio-brand__findings">
      <summary><StatusPill state="limited">{`${findings.length} to review`}</StatusPill></summary>
      <p className="studio-brand__findings-about">{FINDINGS_ABOUT[about]}</p>
      <FindingList findings={findings} />
    </details>
  );
}
const FindingList = ({ findings }: { findings: ColourFinding[] }) => (
  <ul className="studio-brand__finding-list">
    {findings.map((f, i) => <li key={i}><strong>{f.title}</strong>{f.appearance === "both" ? "" : ` (${f.appearance})`}: {f.message.replace(/\.$/, "")}. <span className="studio-meta">{f.rule}</span></li>)}
  </ul>
);

/* The engine's settings for one option, as sliders. Moving one makes the option again at once; the state is the provider's, so the card and the larger view show the same thing. */
function Sliders({ option, ranges, where }: { option: PaletteOption; ranges: AdjustRange[]; where: "card" | "popout" }) {
  const b = useBrand();
  const state = b.live[option.id];
  const values = state?.values ?? option.settings;
  const changed = b.isChanged(option.id);
  return (
    <div className="studio-brand__adjust-body">
      <div className="studio-brand__sliders" data-non-agent="adjusting is the app room's adjust-brand-option action">
        {ranges.map((r) => (
          <label key={r.name} className="studio-brand__slider">
            <span>{r.label} <code>{Number(values[r.name] ?? r.default).toFixed(r.step >= 1 ? 0 : 2)}</code></span>
            <input type="range" data-non-agent="adjusting is the app room's adjust-brand-option action" min={r.min} max={r.max} step={r.step} value={values[r.name] ?? r.default}
              aria-label={`${r.label} for ${option.title}${where === "popout" ? " (larger view)" : ""}`}
              onChange={(e) => b.setSetting(option.id, r.name, Number(e.target.value))} />
          </label>
        ))}
      </div>
      <div className="studio-brand__adjust-foot">
        <Button size="sm" variant="secondary" disabled={!changed} onClick={() => b.resetOption(option.id)}
          agent={{ nonAgent: "resetting an option is the app room's reset-brand-option action" }}>Reset to the original</Button>
        <span className="studio-brand__updating studio-meta" role="status" data-updating={state?.updating ? "" : undefined}>{state?.updating ? "Updating…" : ""}</span>
      </div>
      {state?.problem ? <p className="studio-brand__adjust-problem" role="alert">{`${state.problem} The option shows the last settings that fit.`}</p> : null}
    </div>
  );
}

function Adjust({ option, ranges }: { option: PaletteOption; ranges: AdjustRange[] }) {
  const b = useBrand();
  return (
    <details className="studio-brand__adjust" open={b.isChanged(option.id) || undefined}>
      <summary>Adjust this option</summary>
      <p className="studio-meta">Each change makes the option again with the palette engine, so it still meets the contrast rules. Or tell the App Expert, for example "a bit darker and less saturated".</p>
      <Sliders option={option} ranges={ranges} where="card" />
    </details>
  );
}

function OptionCard({ option, index, appearance, current, ranges, busy, onChoose, onOpen }: { option: PaletteOption; index: number; appearance: "light" | "dark"; current: boolean; ranges: AdjustRange[]; busy: string | null; onChoose(): void; onOpen(): void }) {
  const sw = option.swatches[appearance];
  return (
    <article className="studio-brand__option" aria-labelledby={`brand-option-${option.id}`} data-option-id={option.id} data-adjusted={option.adjusted ? "" : undefined}>
      <header className="studio-brand__option-head">
        <h4 id={`brand-option-${option.id}`}>{`${index + 1}. ${option.title}`}</h4>
        <Cluster gap={2}>
          {option.adjusted ? <StatusPill state="evaluation">Adjusted</StatusPill> : null}
          <Findings findings={option.findings} about="option" />
        </Cluster>
      </header>
      <p className="studio-meta">{option.description}</p>
      <Specimen option={option} appearance={appearance} />
      <div className="studio-brand__swatches">
        <Swatch hex={sw.structure} label="Buttons" />
        <Swatch hex={sw.accent} label="Links" />
        <Swatch hex={sw.ground} label="Page" />
      </div>
      <Adjust option={option} ranges={ranges} />
      <Cluster gap={2}>
        <Button onClick={onChoose} busy={busy === "saving"} disabled={current} agent={{ nonAgent: "choosing an option is the app room's choose-brand-option action" }}>
          {current ? "In use" : "Use this option"}
        </Button>
        <Button variant="secondary" onClick={onOpen} aria-label={`Open ${option.title} larger`} agent={{ nonAgent: "the larger view is for the person to look at; the App Expert reads the options from the brand observation" }}>Open larger</Button>
      </Cluster>
    </article>
  );
}

/* One option, large: light and dark side by side on a fuller sample screen,
   its colours, the style, the same live sliders and reset as its card, and
   what it leaves to review. ux-builder's Dialog: focus stays inside, Escape
   closes it, and focus returns to the button that opened it. */
function OptionPopout({ option, index, open, current, ranges, onClose, onChoose, busy }: { option: PaletteOption | null; index: number; open: boolean; current: boolean; ranges: AdjustRange[]; onClose(): void; onChoose(): void; busy: string | null }) {
  const b = useBrand();
  const c = b.capture;
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} className="studio-brand__popout" closeLabel="Close the larger view"
      title={option ? `${index + 1}. ${option.title}` : ""} description={option?.description}
      data-non-agent="the larger view of an option; its controls repeat the card's, which the app room's brand actions cover"
      actions={option ? (
        <>
          <Button variant="secondary" onClick={onClose} agent={{ nonAgent: "closes the larger view" }}>Close</Button>
          <Button onClick={onChoose} busy={busy === "saving"} disabled={current} agent={{ nonAgent: "choosing an option is the app room's choose-brand-option action" }}>{current ? "In use" : "Use this option"}</Button>
        </>
      ) : undefined}>
      {open && option && c ? (
        <div className="studio-brand__popout-grid" data-option-id={option.id}>
          <div className="studio-brand__popout-stage">
            {(["light", "dark"] as const).map((ap) => (
              <figure key={ap} className="studio-brand__popout-shot">
                <figcaption className="studio-meta">{ap === "light" ? "Light" : "Dark"}</figcaption>
                <Specimen option={option} appearance={ap} large />
                <div className="studio-brand__swatches">
                  <Swatch hex={option.swatches[ap].structure} label="Buttons" />
                  <Swatch hex={option.swatches[ap].accent} label="Links" />
                  <Swatch hex={option.swatches[ap].ground} label="Page" />
                  <Swatch hex={option.swatches[ap].surface} label="Cards" />
                  <Swatch hex={option.swatches[ap].text} label="Text" />
                </div>
              </figure>
            ))}
          </div>
          <aside className="studio-brand__popout-side" aria-label="Style, adjustments and rules">
            <Select label="Style (design system)" value={c.designSystem}
              options={c.styles.map((d) => ({ value: d.name, label: `${d.title}${d.name === c.analysis.style.designSystem ? " (suggested)" : ""}` }))}
              onChange={async (e: any) => { const r = await b.setDesignSystem(e.target.value); setProblem(r.ok ? null : r.message); }}
              agent={{ nonAgent: "the same choice as the panel's style; the App Expert uses set-brand-design-system" }} />
            {problem ? <Notice tone="error" title={problem} /> : null}
            <section aria-labelledby="popout-adjust" className="studio-brand__popout-section">
              <h3 id="popout-adjust">{option.adjusted ? "Adjust (adjusted)" : "Adjust"}</h3>
              <Sliders option={option} ranges={ranges} where="popout" />
            </section>
            <section aria-labelledby="popout-rules" className="studio-brand__popout-section">
              <h3 id="popout-rules">Rules</h3>
              {option.findings.length ? (
                <>
                  <p className="studio-brand__findings-about">{FINDINGS_ABOUT.option}</p>
                  <FindingList findings={option.findings} />
                </>
              ) : <StatusPill state="live">Meets the colour rules</StatusPill>}
            </section>
          </aside>
        </div>
      ) : null}
    </Dialog>
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
  const [popped, setPopped] = useState<string | null>(null);
  const look = s.view?.definition.extensions?.["umf.ux"]?.look ?? { theme: "plain" };
  const c = b.capture;
  const style = c?.styles.find((x) => x.name === c.designSystem);
  const popIndex = b.options.findIndex((o) => o.id === popped);
  const popOption = popIndex >= 0 ? b.options[popIndex] : null;
  const isCurrent = (o: PaletteOption) => !!c && !!b.current && b.current.source?.captureId === c.id && b.current.option.id === o.id && b.current.designSystem === c.designSystem && JSON.stringify(b.current.option.adjusted ?? {}) === JSON.stringify(o.adjusted ?? {});

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
              <Findings findings={style.findings} ok={`${style.title} meets the style rules`} about="style" />
            </div>
          ) : null}

          <h3>4. Three options</h3>
          <Cluster gap={4} align="end">
            <ChoicePicker label="Show in" value={shownIn} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(v: string) => setShownIn(v as "light" | "dark")}
              agent={{ id: "brand.preview-appearance", description: "Whether the options are shown in light or dark" }} />
            <TextField label="Kit name" placeholder={c.name} value={name} onChange={(e: any) => setName(e.target.value)}
              agent={{ id: "brand.kit-name", description: "The name the chosen option is kept under in the brand kit library" }} />
          </Cluster>
          <div className="studio-brand__options" aria-busy={b.busy === "options" || undefined}>
            {b.options.map((o, i) => (
              <OptionCard key={`${c.designSystem}:${o.id}`} option={o} index={i} appearance={shownIn} busy={b.busy} ranges={c.adjustable}
                current={isCurrent(o)}
                onChoose={async () => report(await b.chooseOption(o.id, name))}
                onOpen={() => setPopped(o.id)} />
            ))}
          </div>
          <OptionPopout option={popOption} index={popIndex} open={!!popOption} current={!!popOption && isCurrent(popOption)} ranges={c.adjustable} busy={b.busy}
            onClose={() => setPopped(null)}
            onChoose={async () => { if (!popOption) return; const r = await b.chooseOption(popOption.id, name); report(r); if (r.ok) setPopped(null); }} />
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
