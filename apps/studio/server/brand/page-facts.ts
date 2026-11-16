/* What the studio reads from a website's page, in the page itself: the colours
   its CSS gives its buttons, links, header and headings, the colour custom
   properties it declares on :root, its theme colour and manifest, its fonts,
   the corner radius of its buttons, and which element is its logo (marked
   with data-studio-logo so the caller can screenshot it).

   Kept as a string, not a function: Playwright serialises a function's source,
   and the TypeScript loader may add helpers to it that do not exist in the
   page. Every colour is normalised through a 1×1 canvas, so any CSS colour
   syntax (oklch(), color(), hsl(), named) comes back as #rrggbb. */

export type PageButton = { bg: string | null; fg: string | null; border: string | null; radius: number; pill: boolean; area: number; text: string };
export type PageFacts = {
  title: string;
  siteName: string | null;
  themeColor: string | null;
  manifestHref: string | null;
  page: { background: string; text: string | null };
  buttons: PageButton[];
  links: Array<{ hex: string; count: number }>;
  header: string | null;
  headings: Array<{ hex: string | null; family: string }>;
  variables: Array<{ name: string; hex: string }>;
  fonts: { body: string; heading: string | null; loaded: string[] };
  logo: { found: boolean; kind: string | null; width: number; height: number };
};

export const PAGE_FACTS = String.raw`(() => {
  const vw = innerWidth, vh = innerHeight;
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toHex = (v) => {
    if (!v) return null;
    v = String(v).trim();
    if (!v || v === "transparent" || v === "none" || v.startsWith("var(")) return null;
    if (/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(v)) v = "hsl(" + v + ")";
    cx.fillStyle = "#010203";
    cx.fillStyle = v;
    if (cx.fillStyle === "#010203" && !/^#010203$/i.test(v)) return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    if (a < 128) return null;
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const visible = (el, depth = 2.5) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.1 && r.top < vh * depth && r.bottom > 0;
  };
  const first = (stack) => String(stack || "").split(",")[0].trim().replace(/^["']|["']$/g, "");

  const bodyBg = toHex(getComputedStyle(document.body).backgroundColor) || toHex(getComputedStyle(document.documentElement).backgroundColor) || "#ffffff";
  const bodyFg = toHex(getComputedStyle(document.body).color);

  const BUTTON = 'button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn" i], a[class*="button" i], a[class*="cta" i]';
  const buttons = [...document.querySelectorAll(BUTTON)].filter((el) => visible(el)).slice(0, 120).map((el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const radius = parseFloat(s.borderTopLeftRadius) || 0;
    const bw = parseFloat(s.borderTopWidth) || 0;
    return {
      bg: toHex(s.backgroundColor), fg: toHex(s.color), border: bw >= 1 ? toHex(s.borderTopColor) : null,
      radius, pill: r.height > 0 && radius >= r.height / 2 - 1, area: Math.round(r.width * r.height),
      text: String(el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 40),
    };
  });

  const linkCounts = new Map();
  for (const el of [...document.querySelectorAll("a[href]")].filter((a) => !a.matches(BUTTON) && visible(a)).slice(0, 300)) {
    const hex = toHex(getComputedStyle(el).color);
    if (hex) linkCounts.set(hex, (linkCounts.get(hex) || 0) + 1);
  }

  const headerEl = [...document.querySelectorAll("header, [role=banner], nav")].find((el) => visible(el, 1));
  const header = headerEl ? toHex(getComputedStyle(headerEl).backgroundColor) : null;
  const headings = [...document.querySelectorAll("h1, h2")].filter((el) => visible(el)).slice(0, 8).map((el) => ({ hex: toHex(getComputedStyle(el).color), family: first(getComputedStyle(el).fontFamily) }));

  const declared = new Map();
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
      if (!r.style || !r.selectorText || !/(^|,)\s*(:root|html|body)\b/.test(r.selectorText)) continue;
      for (const p of r.style) if (p.startsWith("--") && declared.size < 600 && !declared.has(p)) declared.set(p, true);
    }
  };
  for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules; } catch { continue; } if (rules) walk(rules); }
  const root = getComputedStyle(document.documentElement);
  const variables = [];
  for (const name of declared.keys()) {
    const hex = toHex(root.getPropertyValue(name));
    if (hex) variables.push({ name, hex });
  }

  const loaded = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")))];

  const LOGO = 'header img, header svg, [class*="logo" i] img, [class*="logo" i] svg, [id*="logo" i] img, [id*="logo" i] svg, img[alt*="logo" i], img[src*="logo" i], a[aria-label*="home" i] svg, a[aria-label*="home" i] img, a[href="/"] img, a[href="/"] svg';
  const logos = [...document.querySelectorAll(LOGO)].filter((el) => visible(el, 1)).map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width >= 24 && r.height >= 12 && r.top < 260 && r.width < vw * 0.6)
    .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
  const logo = logos[0];
  if (logo) logo.el.setAttribute("data-studio-logo", "1");

  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || null;
  return {
    title: document.title || location.hostname,
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    themeColor: toHex(meta('meta[name="theme-color"]:not([media])') || meta('meta[name="theme-color"]')),
    manifestHref: document.querySelector('link[rel="manifest"]')?.href || null,
    page: { background: bodyBg, text: bodyFg },
    buttons,
    links: [...linkCounts].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    header,
    headings,
    variables,
    fonts: { body: first(getComputedStyle(document.body).fontFamily), heading: headings[0]?.family || null, loaded },
    logo: { found: !!logo, kind: logo ? logo.el.tagName.toLowerCase() : null, width: logo ? Math.round(logo.r.width) : 0, height: logo ? Math.round(logo.r.height) : 0 },
  };
})()`;
