/* A brand kit as a Design Tokens Community Group file (format 2025.10,
   .tokens.json), so the brand can leave the studio: primitives (the brand's
   own colours, from the website) and semantic roles for each appearance,
   with colours as sRGB objects and fonts as font families. */

import type { BrandKit } from "./store.js";

const colour = (hex: string, description?: string) => {
  const h = hex.replace("#", "").toLowerCase();
  const components = [0, 2, 4].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 10000) / 10000);
  return { $type: "color", $value: { colorSpace: "srgb", components, hex: `#${h}` }, ...(description ? { $description: description } : {}) };
};

export function toDtcg(kit: BrandKit) {
  const out: Record<string, any> = {
    $description: `${kit.name}: a UX Builder Studio brand kit (${kit.option.title}, on the ${kit.designSystem} design system)${kit.source ? `, from ${kit.source.url}` : ""}.`,
    primitive: { brand: Object.fromEntries(kit.colours.map((c, i) => [String(i + 1), colour(c.hex, `Seen on the website: ${c.sources.join(", ")}`)])) },
  };
  for (const [appearance, groups] of Object.entries(kit.brand.appearances) as Array<[string, Record<string, Record<string, { $value: string; $description?: string }>>]>) {
    out[appearance] = {};
    for (const [group, roles] of Object.entries(groups)) {
      const entries = Object.entries(roles).filter(([, t]) => /^#[0-9a-f]{6}$/i.test(String(t.$value)));
      if (entries.length) out[appearance][group] = Object.fromEntries(entries.map(([role, t]) => [role, colour(t.$value, t.$description)]));
    }
  }
  if (kit.brand.fonts) out.font = Object.fromEntries(Object.entries(kit.brand.fonts).map(([role, f]) => [role, { $type: "fontFamily", $value: [f.family, ...f.fallback] }]));
  return out;
}
