/* Three palette options aligned with a site's brand, each fitted to
   ux-builder's contrast gate by its palette engine, composed on the chosen
   design system, and checked against the colour rules.

   The engine makes up to nine options from the brand colours (faithful,
   muted, vibrant, neutral-accent, two-colour, and softer or stronger
   variants). The studio offers three: the one closest to the site first,
   then the two that meet the most rules, preferring variety. An option that
   breaks a rule people rely on (contrast, red on actions) is never offered.

   A red brand: red is kept for errors and destructive actions
   (color.red-reserved), so buttons, links and focus take the brand's next
   colour, or a deep blue when it has none, and the red stays the logo's and
   identity's colour. */

import { candidateOf, generate, designSystems, parseHex } from "@ux-builder/engine/node";
import type { BrandAnalysis } from "./analyse.js";
import { checkPalette, isRed, MARGIN, type Finding } from "./checks.js";
import { resolveBoth, type BrandDoc, type Resolved } from "./tokens.js";

export type PaletteOption = {
  id: string;
  title: string;
  description: string;
  strategy: string;
  brand: BrandDoc & { generation?: unknown };
  tokens: Resolved;
  swatches: Record<"light" | "dark", Record<"structure" | "accent" | "ground" | "surface" | "text", string>>;
  findings: Finding[];
};
export type Options = { designSystem: string; options: PaletteOption[]; notes: string[] };

const ABOUT: Record<string, { title: string; description: string }> = {
  faithful: { title: "Closest to the site", description: "The brand colour on primary buttons, links and focus, as the website uses it." },
  "two-colour": { title: "Two brand colours", description: "The main brand colour on primary buttons; the second for links and focus." },
  "neutral-accent": { title: "Neutral with a brand accent", description: "Ink-dark primary buttons; the brand colour on links, focus and highlights. Calm on busy, data-heavy screens." },
  muted: { title: "Deep and calm", description: "A deeper, quieter shade of the brand colour on buttons and links." },
  vibrant: { title: "Bright", description: "A brighter brand colour, for apps that should feel energetic." },
};
const about = (label: string) => {
  const [base, kind] = label.split(/-(softer|stronger)$/);
  const a = ABOUT[base] ?? { title: base, description: "" };
  return kind ? { title: `${a.title}, ${kind}`, description: `${a.description} ${kind === "softer" ? "Less saturated." : "More saturated."}` } : a;
};
const PREFERENCE = ["faithful", "two-colour", "neutral-accent", "muted", "vibrant", "muted-softer", "faithful-softer", "vibrant-stronger", "neutral-accent-stronger"];
const SUGGESTED_BLUE = 255;

/* The site's fonts that ux-builder bundles (anything else would not load offline). */
const BUNDLED: Record<string, string[]> = {
  "dm sans": ["system-ui", "sans-serif"],
  "ibm plex sans": ["system-ui", "sans-serif"],
  roboto: ["system-ui", "sans-serif"],
  quicksand: ["system-ui", "sans-serif"],
  "zilla slab": ["Georgia", "serif"],
};
const canonical: Record<string, string> = { "dm sans": "DM Sans", "ibm plex sans": "IBM Plex Sans", roboto: "Roboto", quicksand: "Quicksand", "zilla slab": "Zilla Slab" };

export function fontsFor(analysis: Pick<BrandAnalysis, "fonts">) {
  const pick = (family: string | null) => {
    const key = String(family ?? "").toLowerCase();
    return BUNDLED[key] ? { family: canonical[key], fallback: BUNDLED[key] } : null;
  };
  const body = pick(analysis.fonts.body), heading = pick(analysis.fonts.heading) ?? body;
  const fonts: NonNullable<BrandDoc["fonts"]> = {};
  if (body) fonts.body = body;
  if (heading) { fonts.heading = heading; fonts.display = heading; }
  const note = (role: string, family: string | null, used: unknown) =>
    family && !used && !/^(system-ui|-apple-system|blinkmacsystemfont|segoe ui|helvetica|helvetica neue|arial|sans-serif|serif|inter)$/i.test(family)
      ? `The site's ${role} font, ${family}, is not bundled with ux-builder, so the design system's font stands in.` : null;
  return { fonts: Object.keys(fonts).length ? fonts : undefined, notes: [note("text", analysis.fonts.body, body), analysis.fonts.heading !== analysis.fonts.body ? note("heading", analysis.fonts.heading, fonts.heading) : null].filter(Boolean) as string[] };
}

export function paletteOptions(analysis: BrandAnalysis, designSystem: string): Options {
  const notes: string[] = [];
  let candidates = analysis.colours.map((c) => candidateOf(parseHex(c.hex), c.share));
  const top = analysis.colours[0]?.hex;
  const redBrand = !!top && isRed(top);
  if (redBrand) {
    // Actions take a colour the site itself uses on its links or buttons; a colour seen only in its CSS or imagery is not evidence enough.
    candidates = analysis.colours
      .filter((c) => !isRed(c.hex) && c.sources.some((s) => s.kind === "links" || s.kind === "buttons"))
      .map((c) => candidateOf(parseHex(c.hex), c.share));
    notes.push(candidates.length
      ? `The brand's red (${top}) stays its logo and identity colour; buttons, links and focus use ${candidates[0].hex.toLowerCase()}, the colour of the site's own links and buttons, because red is kept for errors and destructive actions.`
      : `The brand's red (${top}) stays its logo and identity colour; buttons, links and focus use a deep blue, because red is kept for errors and destructive actions and the site's links and buttons use no other colour.`);
  }
  const engineAnalysis = { format: "url", candidates, monochrome: candidates.length === 0, warnings: [] as string[] };
  // Fitted to theme.contrast-margin's 4.7:1, not just the 4.5:1 gate, so key colours have room to spare.
  const settings = { minContrast: MARGIN, ...(candidates.length ? {} : { suggestedHue: SUGGESTED_BLUE }) };
  const { options } = generate(engineAnalysis, settings, { designSystems: designSystems() });
  const { fonts, notes: fontNotes } = fontsFor(analysis);
  notes.push(...fontNotes);

  const built: PaletteOption[] = options.map((o: any) => {
    const brand: PaletteOption["brand"] = { name: "brand", appearances: structuredClone(o.brand.appearances), ...(fonts ? { fonts } : {}), generation: o.brand.generation };
    if (top) for (const ap of Object.values(brand.appearances) as any[]) if (ap.brand?.["logo-paint"]) ap.brand["logo-paint"] = { $value: top.toUpperCase(), $description: "The brand's top colour, from the website." };
    const tokens = resolveBoth(brand, designSystem);
    const sw = (t: Record<string, string>) => ({ structure: t["piq-color-structure"], accent: t["piq-color-accent"], ground: t["piq-color-ground"], surface: t["piq-color-surface"], text: t["piq-color-text"] });
    return { id: o.label, ...about(o.label), strategy: o.strategy, brand, tokens, swatches: { light: sw(tokens.light), dark: sw(tokens.dark) }, findings: checkPalette(tokens) };
  });

  const offered = built.filter((o) => !o.findings.some((f) => f.severity === "error"));
  const rank = (o: PaletteOption) => PREFERENCE.indexOf(o.id) === -1 ? 99 : PREFERENCE.indexOf(o.id);
  const closest = offered.filter((o) => o.strategy === "faithful" || o.strategy === "two-colour").sort((a, b) => rank(a) - rank(b))[0];
  const rest = offered.filter((o) => o !== closest).sort((a, b) => a.findings.length - b.findings.length || rank(a) - rank(b));
  // Prefer three different strategies before a variant of one already chosen.
  const chosen: PaletteOption[] = closest ? [closest] : [];
  for (const pass of [true, false]) for (const o of rest) {
    if (chosen.length >= 3 || chosen.includes(o)) continue;
    if (pass && chosen.some((x) => x.strategy === o.strategy)) continue;
    chosen.push(o);
  }
  if (chosen.length < 3) notes.push(`Only ${chosen.length} option${chosen.length === 1 ? "" : "s"} met the contrast and colour rules.`);
  return { designSystem, options: chosen, notes };
}
