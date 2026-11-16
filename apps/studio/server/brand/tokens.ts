/* A brand on one of ux-builder's shared design systems, as resolved tokens
   (--piq-* names and final values) for each appearance: what ThemeProvider
   takes as its tokens prop, so a brand kit dresses an app at run time
   without a published theme. Composition is ux-builder's own (compose-core,
   the same code its build and theme builder use). */

import { designSystems } from "@ux-builder/engine/node";
// @ts-ignore: ux-builder's composition (plain JS, no types).
import { composeOn, resolveAll } from "../../../../vendor/ux-builder/packages/tokens/compose-core.mjs";
import type { DesignSystemName } from "./analyse.js";

export type BrandDoc = { name?: string; appearances: Record<string, unknown>; fonts?: Record<string, { family: string; fallback: string[] }> };
export type Resolved = { light: Record<string, string>; dark: Record<string, string> };

export const DESIGN_SYSTEMS: Array<{ name: DesignSystemName; title: string; summary: string }> = [
  { name: "databricks", title: "Databricks", summary: "Rounded controls (8 px), DM Sans" },
  { name: "material", title: "Material Design 3", summary: "Pill-shaped buttons, Roboto" },
  { name: "fluent", title: "Fluent 2", summary: "Slightly rounded controls (4 px), Segoe UI" },
  { name: "carbon", title: "Carbon", summary: "Square controls, IBM Plex Sans" },
];

export function designSystem(name: string) {
  const ds = designSystems().find((d: any) => d.name === name);
  if (!ds) throw new Error(`There is no design system ${name}; choose ${DESIGN_SYSTEMS.map((d) => d.name).join(", ")}`);
  return ds;
}

export function resolve(brand: BrandDoc, dsName: string, appearance: "light" | "dark"): Record<string, string> {
  const map = resolveAll(composeOn({ name: brand.name ?? "brand", ...brand }, designSystem(dsName), appearance), `brand × ${dsName}`) as Map<string, string>;
  return Object.fromEntries([...map].map(([p, v]) => [`piq-${p.replace(/\./g, "-")}`, String(v)]));
}

export const resolveBoth = (brand: BrandDoc, dsName: string): Resolved => ({ light: resolve(brand, dsName, "light"), dark: resolve(brand, dsName, "dark") });
