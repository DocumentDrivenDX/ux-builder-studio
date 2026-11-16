/* ux-builder's colour rules, measured on a palette's resolved tokens in each
   appearance. These follow the theme checks proposed upstream (ux-builder PR
   #81, tools/theme-rules.mjs) for what a palette decides: red kept for
   errors, contrast with a margin, distinct text tiers, structure apart from
   accent, cards apart from the page, and a dark appearance of its own. When
   that PR lands, the studio runs its checks directly instead.

   An "error" finding breaks a rule people rely on (contrast below the WCAG
   minimum, red on buttons and links); an option with one is never offered.
   A "review" finding is a proposed rule the option does not fully meet; the
   option is offered with the finding shown. */

// @ts-ignore: ux-builder's contrast helpers (plain JS, no types).
import { deltaE, NORMAL_FLOOR, ratio, solid } from "../../../../vendor/ux-builder/tools/contrast.mjs";
import { hexToOklch } from "@ux-builder/engine/node";

export type Tokens = Record<string, string>;
export type Finding = { rule: string; appearance: "light" | "dark" | "both"; severity: "error" | "review"; message: string };

/* The rules these checks serve, as ux-builder states them. */
export const COLOUR_RULES: Record<string, { title: string; statement: string }> = {
  "theme.contrast": { title: "Text and controls meet contrast minimums", statement: "Text meets a contrast ratio of at least 4.5:1 (3:1 for large text) and controls' boundaries at least 3:1, in every appearance." },
  "color.red-reserved": { title: "Red is reserved for errors, warnings and destruction", statement: "Red, and hues close to it, is used only for errors, critical warnings and destructive actions. If the brand's primary is red, primary buttons, links, selection and focus use a non-red colour instead." },
  "theme.contrast-margin": { title: "Key colours clear contrast with room to spare", statement: "Accent, primary-action, status and subtle-text colours clear the WCAG minimum with a margin (about 4.7:1 or more) in both appearances." },
  "theme.text-tiers": { title: "Text colour tiers are visibly different", statement: "Strong, default, muted and subtle text are visibly different steps in every appearance." },
  "theme.structure-accent-distinct": { title: "Structure and accent are different colours", statement: "The structure colour (primary buttons, headings, chrome) and the accent (links, selection, focus) are clearly different tones in every appearance." },
  "theme.surface-separation": { title: "Cards and menus stand out from the page", statement: "Cards, menus and dialogs separate from the page ground in every appearance, by tone (about 1.25:1), a visible border, or a shadow tuned for that appearance." },
  "theme.dark-appearance": { title: "Every theme ships a designed dark appearance", statement: "The dark appearance sets its own value for every colour and shadow, rather than inheriting light's." },
};

export const GATE = 4.5;
export const MARGIN = 4.7;
const TIER_STEP = 1.1;
const SURFACE_STEP = 1.25;
const DARK_SHADOW_ALPHA = 0.3;
const c = (n: string) => `piq-color-${n}`;

/* Red and the hues next to it, with enough chroma to read as a colour (PR #81's isRed). */
export const isRed = (hex: string) => { const { c: C, h } = hexToOklch(hex); return C >= 0.1 && (h < 45 || h > 340); };

const colourIn = (v: unknown) => /(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b)/i.exec(String(v ?? ""))?.[1] ?? null;
const alphas = (shadow: unknown) => [...String(shadow ?? "").matchAll(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1]));
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function checkAppearance(t: Tokens, appearance: "light" | "dark"): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, severity: Finding["severity"], message: string) => out.push({ rule, appearance, severity, message });
  const ground = solid(t[c("ground")]), surface = solid(t[c("surface")]);
  const grounds = [ground, surface].filter(Boolean) as string[];

  const roles: Array<[string, string | null]> = [
    ["links and selection (accent)", solid(t[c("accent")])],
    ["primary buttons (structure)", solid(t[c("structure")])],
    ["the focus ring", colourIn(t["piq-focus-ring"])],
  ];
  for (const [role, v] of roles) if (v && isRed(v)) add("color.red-reserved", "error", `${role} would be red (${v}); red is kept for errors and destructive actions`);

  const pairs: Array<[string, string, string[]]> = [
    ["Body text", c("text"), [c("ground"), c("surface")]],
    ["Links (accent)", c("accent"), [c("ground"), c("surface")]],
    ["Muted text", c("text-muted"), [c("ground"), c("surface")]],
    ["Subtle text", c("text-subtle"), [c("ground"), c("surface")]],
    ["Primary button label", c("surface"), [c("structure")]],
  ];
  for (const [label, fg, bgs] of pairs) {
    const a = solid(t[fg]);
    if (!a) continue;
    for (const bg of bgs) {
      const b = solid(t[bg]);
      if (!b) continue;
      const r = ratio(a, b) as number;
      const on = bg === c("structure") ? "the primary button" : bg === c("surface") ? "cards" : "the page";
      if (r < GATE) add("theme.contrast", "error", `${label} on ${on} is ${r.toFixed(2)}:1; at least ${GATE}:1`);
      else if (r < MARGIN && fg !== c("text")) add("theme.contrast-margin", "review", `${label} on ${on} is ${r.toFixed(2)}:1, on the line; about ${MARGIN}:1 leaves room`);
    }
  }

  const tiers = ["text-strong", "text", "text-muted", "text-subtle"].map((n) => [n, solid(t[c(n)])] as const).filter(([, v]) => v);
  for (let i = 1; i < tiers.length; i++) {
    const [[an, a], [bn, b]] = [tiers[i - 1], tiers[i]];
    const r = ratio(a, b) as number;
    if (r < TIER_STEP) add("theme.text-tiers", "review", `${an} and ${bn} text are only ${r.toFixed(2)}:1 apart`);
  }

  const s = solid(t[c("structure")]), acc = solid(t[c("accent")]);
  if (s && acc) {
    const d = deltaE(s, acc) as number;
    if (d < NORMAL_FLOOR) add("theme.structure-accent-distinct", "review", d < 1 ? "Primary buttons and links use the same colour" : `Primary buttons (${s}) and links (${acc}) are close in colour (ΔE ${d.toFixed(0)})`);
  }

  if (ground && surface) {
    const tone = ratio(surface, ground) as number;
    const border = solid(t[c("border")]);
    const edge = border ? Math.max(ratio(border, ground), ratio(border, surface)) : 0;
    const a = alphas(t["piq-shadow-card"]);
    const dark = luminance(ground) < 0.2;
    const shadow = a.length > 0 && Math.max(...a) >= (dark ? DARK_SHADOW_ALPHA : 0.04);
    if (tone < SURFACE_STEP && edge < SURFACE_STEP && !shadow) add("theme.surface-separation", "review", `Cards barely stand off the page (tone ${tone.toFixed(2)}:1, border ${edge.toFixed(2)}:1${a.length ? `, shadow ${Math.max(...a)} alpha` : ", no shadow"})`);
  }
  return out;
}

const DARK_OWN = ["ground", "surface", "text", "text-strong", "text-muted", "text-subtle", "border", "structure", "accent"].map(c);

export function checkPalette(tokens: { light: Tokens; dark: Tokens }): Finding[] {
  const out = [...checkAppearance(tokens.light, "light"), ...checkAppearance(tokens.dark, "dark")];
  const same = DARK_OWN.filter((k) => tokens.light[k] !== undefined && tokens.light[k] === tokens.dark[k]);
  if (same.length) out.push({ rule: "theme.dark-appearance", appearance: "dark", severity: "review", message: `Dark reuses light's ${same.map((k) => k.replace("piq-color-", "")).join(", ")}` });
  return out;
}
