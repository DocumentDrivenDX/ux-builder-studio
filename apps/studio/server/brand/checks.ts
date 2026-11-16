/* ux-builder's theme and colour rules, measured on a palette's resolved
   tokens in each appearance, with ux-builder's own theme checks
   (tools/theme-rules.mjs, from its PR #81) plus the WCAG contrast gate.

   The findings fall in two groups:
   - palette: what the colours decide (red kept for errors, contrast and its
     margin, text tiers, structure apart from accent, cards apart from the
     page, a dark appearance of its own). They differ between options.
   - style: what the design system decides (focus ring, small text, weights,
     type families). They are the same for every option on that design
     system, so they are shown once, beside the style choice.

   An "error" breaks a rule people rely on (contrast below the WCAG minimum,
   red on actions); an option with one is never offered. A "review" is a
   rule the option or style does not fully meet; it is shown, not hidden. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore: ux-builder's tools (plain JS, no types).
import { CHECKS, checkAppearance as themeChecks, checkTheme, isRed as upstreamIsRed } from "../../../../vendor/ux-builder/tools/theme-rules.mjs";
// @ts-ignore: ux-builder's tools (plain JS, no types).
import { ratio, solid } from "../../../../vendor/ux-builder/tools/contrast.mjs";

export type Tokens = Record<string, string>;
export type Finding = { rule: string; title: string; appearance: "light" | "dark" | "both"; severity: "error" | "review"; message: string };

const RULES: Map<string, { title: string; statement: string; status?: string }> = new Map(
  (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "vendor", "ux-builder", "guidelines", "rules.json"), "utf8")).rules as Array<{ id: string; title: string; statement: string; status?: string }>).map((r) => [r.id, r]),
);
const RULE_OF: Record<string, string> = CHECKS;
export const ruleTitle = (id: string) => RULES.get(id)?.title ?? id;

export const GATE = 4.5;
export const MARGIN = 4.7;
export const isRed = (hex: string): boolean => upstreamIsRed(hex);

/* The checks the design system settles, not the palette. */
const STYLE_CHECKS = new Set(["theme-focus-ring", "theme-small-text", "theme-weights", "theme-families"]);
const sentence = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
const c = (n: string) => `piq-color-${n}`;

function gate(t: Tokens, appearance: "light" | "dark"): Finding[] {
  const out: Finding[] = [];
  const pairs: Array<[string, string, string[]]> = [
    ["Body text", c("text"), [c("ground"), c("surface")]],
    ["Links (accent)", c("accent"), [c("ground"), c("surface")]],
    ["Muted text", c("text-muted"), [c("ground"), c("surface")]],
    ["Subtle text", c("text-subtle"), [c("ground"), c("surface")]],
    ["The primary button's label", c("surface"), [c("structure")]],
  ];
  for (const [label, fg, bgs] of pairs) {
    const a = solid(t[fg]);
    if (!a) continue;
    for (const bg of bgs) {
      const b = solid(t[bg]);
      const r = b ? (ratio(a, b) as number) : Infinity;
      if (r < GATE) out.push({ rule: "theme.contrast", title: ruleTitle("theme.contrast"), appearance, severity: "error", message: `${label} on ${bg === c("structure") ? "the primary button" : bg === c("surface") ? "cards" : "the page"} is ${r.toFixed(2)}:1; at least ${GATE}:1` });
    }
  }
  return out;
}

function findings(t: Tokens, appearance: "light" | "dark", want: "palette" | "style"): Finding[] {
  const upstream = (themeChecks(t) as Array<{ check: string; key: string; message: string }>)
    .filter((f) => STYLE_CHECKS.has(f.check) === (want === "style"))
    .map((f): Finding => {
      const rule = RULE_OF[f.check] as string;
      return { rule, title: ruleTitle(rule), appearance, severity: f.check === "theme-red-reserved" ? "error" : "review", message: sentence(f.message) };
    });
  return want === "palette" ? [...gate(t, appearance), ...upstream] : upstream;
}

/* One palette on one design system, in both appearances. */
export function checkPalette(tokens: { light: Tokens; dark: Tokens }): Finding[] {
  const dark = (checkTheme(tokens) as Array<{ check: string; key: string; message: string }>)
    .filter((f) => f.key.startsWith("piq-color-"))
    .map((f): Finding => ({ rule: RULE_OF[f.check], title: ruleTitle(RULE_OF[f.check]), appearance: "dark", severity: "review", message: sentence(f.message) }));
  return [...findings(tokens.light, "light", "palette"), ...findings(tokens.dark, "dark", "palette"), ...dark];
}

/* What a design system decides, measured with one palette on it; a finding in both appearances is listed once. */
export function checkStyle(tokens: { light: Tokens; dark: Tokens }): Finding[] {
  const light = findings(tokens.light, "light", "style"), darkF = findings(tokens.dark, "dark", "style");
  const both = light.filter((f) => darkF.some((d) => d.rule === f.rule && d.message === f.message)).map((f) => ({ ...f, appearance: "both" as const }));
  const only = (list: Finding[]) => list.filter((f) => !both.some((b) => b.rule === f.rule && b.message === f.message));
  const shadows = (checkTheme(tokens) as Array<{ check: string; key: string; message: string }>).filter((f) => !f.key.startsWith("piq-color-"))
    .map((f): Finding => ({ rule: RULE_OF[f.check], title: ruleTitle(RULE_OF[f.check]), appearance: "dark", severity: "review", message: sentence(f.message) }));
  return [...both, ...only(light), ...only(darkF), ...shadows];
}
