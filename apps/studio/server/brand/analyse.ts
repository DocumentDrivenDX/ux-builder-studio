/* From a captured page to its brand: the colours that identify it, ranked,
   with where each was seen; its fonts; and the style its controls suggest.

   Structured sources count most (the AI design tools analysis found reading a
   site's CSS beats sampling its pixels): the colour of its buttons, links,
   theme colour, manifest and brand-named custom properties. The screenshot
   and the logo, analysed by ux-builder's palette engine, confirm and fill in.
   Only identity colours count (the engine's test: chroma and lightness that
   read as a colour, not ink, paper or grey). Near-identical colours from
   different sources fold together; the exact CSS value names the group. */

import { analyse as analyseImage, candidateOf, foldDistance, hexToOklch, inflate, isIdentity, parseHex } from "@ux-builder/engine/node";
import type { Capture } from "./capture.js";

export type Source = { kind: "buttons" | "links" | "theme-color" | "manifest" | "header" | "headings" | "variable" | "screenshot" | "logo"; label: string };
export type BrandColour = { hex: string; share: number; oklch: { l: number; c: number; h: number }; sources: Source[] };
export type DesignSystemName = "databricks" | "material" | "fluent" | "carbon";
export type BrandAnalysis = {
  colours: BrandColour[];
  monochrome: boolean;
  page: { appearance: "light" | "dark"; background: string; text: string | null };
  fonts: { body: string; heading: string | null; loaded: string[] };
  style: { buttonRadius: number | null; pill: boolean; designSystem: DesignSystemName; reason: string };
  warnings: string[];
};

/* How much each kind of evidence weighs. */
export const WEIGHTS = { buttons: 6, links: 3, "theme-color": 3, manifest: 2, header: 1.5, headings: 1, brandVariable: 1.5, variable: 0.25, screenshot: 4, logo: 5 } as const;
/* Colours closer than this (the engine's fold distance, a little wider since CSS and anti-aliased pixels differ) are one colour. */
const SAME = 0.08;
const KEEP = 3;
const BRAND_NAME = /(primary|brand|accent|main|theme|cta|action|highlight)/i;

type Signal = { hex: string; weight: number; source: Source };

export async function analyseCapture(c: Capture): Promise<BrandAnalysis> {
  const f = c.facts;
  const warnings = [...c.warnings];
  const signals: Signal[] = [];
  const add = (hex: string | null | undefined, weight: number, source: Source) => {
    if (!hex || weight <= 0) return;
    if (!isIdentity(parseHex(hex))) return;
    signals.push({ hex: hex.toLowerCase(), weight, source });
  };

  // Buttons: filled ones by the area they cover, outlined ones by their border.
  const filled = f.buttons.filter((b) => b.bg && isIdentity(parseHex(b.bg)));
  const filledArea = filled.reduce((a, b) => a + b.area, 0) || 1;
  for (const b of filled) add(b.bg, WEIGHTS.buttons * (b.area / filledArea), { kind: "buttons", label: "buttons" });
  const outlined = f.buttons.filter((b) => !b.bg && b.border && isIdentity(parseHex(b.border)));
  for (const b of outlined) add(b.border, (WEIGHTS.buttons / 4) / outlined.length, { kind: "buttons", label: "button outlines" });

  const linkTotal = f.links.filter((l) => isIdentity(parseHex(l.hex))).reduce((a, l) => a + l.count, 0) || 1;
  for (const l of f.links) add(l.hex, WEIGHTS.links * (l.count / linkTotal), { kind: "links", label: "links" });
  add(f.themeColor, WEIGHTS["theme-color"], { kind: "theme-color", label: "theme colour" });
  add(c.manifest?.themeColor, WEIGHTS.manifest, { kind: "manifest", label: "app manifest" });
  add(f.header, WEIGHTS.header, { kind: "header", label: "header" });
  for (const h of f.headings) add(h.hex, WEIGHTS.headings / Math.max(1, f.headings.length), { kind: "headings", label: "headings" });
  for (const v of f.variables) add(v.hex, BRAND_NAME.test(v.name) ? WEIGHTS.brandVariable : WEIGHTS.variable, { kind: "variable", label: `CSS ${v.name}` });

  const shot = await analyseImage(new Uint8Array(c.screenshot), { inflate });
  for (const cand of shot.candidates) add(cand.hex, WEIGHTS.screenshot * cand.share, { kind: "screenshot", label: `screenshot (${Math.round(cand.share * 100)}% of its colour)` });
  if (c.logo) {
    const logo = await analyseImage(new Uint8Array(c.logo), { inflate }).catch(() => null);
    for (const cand of logo?.candidates ?? []) add(cand.hex, WEIGHTS.logo * cand.share, { kind: "logo", label: "logo" });
  }

  // Fold: strongest evidence first, so the group is named by its strongest (usually exact CSS) colour.
  signals.sort((a, b) => b.weight - a.weight || (a.hex < b.hex ? -1 : 1));
  const groups: Array<{ hex: string; weight: number; sources: Map<string, Source> }> = [];
  for (const s of signals) {
    const home = groups.find((g) => foldDistance(parseHex(g.hex), parseHex(s.hex)) < SAME);
    if (home) { home.weight += s.weight; home.sources.set(s.source.label, s.source); }
    else groups.push({ hex: s.hex, weight: s.weight, sources: new Map([[s.source.label, s.source]]) });
  }
  groups.sort((a, b) => b.weight - a.weight || (a.hex < b.hex ? -1 : 1));
  const kept = groups.slice(0, KEEP).filter((g, i) => i === 0 || g.weight >= groups[0].weight * 0.08);
  const total = kept.reduce((a, g) => a + g.weight, 0) || 1;
  const colours: BrandColour[] = kept.map((g) => {
    const cand = candidateOf(parseHex(g.hex), Math.round((g.weight / total) * 1000) / 1000);
    return { hex: cand.hex.toLowerCase(), share: cand.share, oklch: cand.oklch, sources: collapse([...g.sources.values()]) };
  });
  if (!colours.length) warnings.push("The site has no brand colour (only black, white and greys); the options use a suggested colour.");

  return {
    colours,
    monochrome: colours.length === 0,
    page: { appearance: hexToOklch(f.page.background).l < 0.5 ? "dark" : "light", background: f.page.background, text: f.page.text },
    fonts: f.fonts,
    style: styleOf(f.buttons.filter((b) => b.bg || b.border)),
    warnings,
  };
}

/* A brand from its logo alone (SVG or PNG): the engine reads its colours
   (by area for a PNG, by how much the markup uses each for an SVG). A logo
   says nothing about fonts or control shapes, so the studio's default style
   is suggested. */
export async function analyseLogo(bytes: Uint8Array): Promise<BrandAnalysis> {
  const found = await analyseImage(bytes, { inflate });
  const colours: BrandColour[] = found.candidates.map((c: any) => ({ hex: c.hex.toLowerCase(), share: c.share, oklch: c.oklch, sources: [{ kind: "logo", label: "logo" }] }));
  return {
    colours,
    monochrome: colours.length === 0,
    page: { appearance: "light", background: "#ffffff", text: null },
    fonts: { body: "", heading: null, loaded: [] },
    style: { buttonRadius: null, pill: false, designSystem: "databricks", reason: "A logo says nothing about control shapes, so the studio's default style is suggested; try the others." },
    warnings: [...found.warnings, ...(colours.length ? [] : ["The logo has no brand colour (only black, white and greys); the options use a suggested colour."])],
  };
}

/* One entry per kind of evidence: many custom properties of one colour read as one ("CSS --a, --b and 4 more"). */
function collapse(sources: Source[]): Source[] {
  const out: Source[] = [];
  for (const kind of [...new Set(sources.map((s) => s.kind))]) {
    const of = sources.filter((s) => s.kind === kind);
    if (kind === "screenshot") { out.push(of[0]); continue; }
    if (kind !== "variable" || of.length === 1) { out.push(...of); continue; }
    const names = of.map((s) => s.label.replace(/^CSS /, ""));
    out.push({ kind, label: `CSS ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}` });
  }
  return out;
}

/* The design system whose controls are shaped most like the site's buttons:
   square corners (Carbon), slightly rounded (Fluent), rounded (Databricks) or
   pill-shaped (Material). */
export function styleOf(buttons: Array<{ radius: number; pill: boolean; area: number }>): BrandAnalysis["style"] {
  if (!buttons.length) return { buttonRadius: null, pill: false, designSystem: "databricks", reason: "The page has no styled buttons to go by, so the studio's default style is suggested." };
  const sorted = [...buttons].sort((a, b) => b.area - a.area).slice(0, 12);
  const pills = sorted.filter((b) => b.pill).length;
  if (pills > sorted.length / 2) return { buttonRadius: 999, pill: true, designSystem: "material", reason: "The site's buttons are pill-shaped, like Material Design's." };
  const radii = sorted.filter((b) => !b.pill).map((b) => b.radius).sort((a, b) => a - b);
  const r = radii[Math.floor(radii.length / 2)] ?? 0;
  const px = Math.round(r);
  if (r <= 1) return { buttonRadius: px, pill: false, designSystem: "carbon", reason: "The site's buttons have square corners, like Carbon's." };
  if (r < 6) return { buttonRadius: px, pill: false, designSystem: "fluent", reason: `The site's buttons have slightly rounded corners (${px} px), like Fluent's.` };
  if (r < 16) return { buttonRadius: px, pill: false, designSystem: "databricks", reason: `The site's buttons have rounded corners (${px} px), like the Databricks style's.` };
  return { buttonRadius: px, pill: false, designSystem: "material", reason: `The site's buttons are very rounded (${px} px), like Material Design's.` };
}
