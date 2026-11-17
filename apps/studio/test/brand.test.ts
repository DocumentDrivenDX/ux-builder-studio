/* Brand from a website: the studio reads two made-up firms' sites (served
   here), finds their brand colours from the CSS, screenshot and logo, offers
   three options that meet ux-builder's colour rules on the design system the
   site's buttons suggest, keeps the chosen one as a brand kit, exports it as
   DTCG tokens, and dresses an app in it. A red brand never puts red on
   buttons, links or focus. */
process.env.STUDIO_PG_MEMORY = "1";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hexToOklch } from "@ux-builder/engine/node";

// Inside a dot-folder, as the studio's own .data is.
process.env.STUDIO_DATA_DIR = join(mkdtempSync(join(tmpdir(), "studio-brand-")), ".data");
const { createApi } = await import("../server/api.ts");
const { isRed } = await import("../server/brand/checks.ts");

const DENIED = "<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>You don't have permission to access this server.<p>Reference #18.4f2a1</p></body></html>";
const sites: Server = createServer((req, res) => {
  let site = String(req.url).split("/")[1];
  // A site that refuses every automated browser, and one that refuses only a browser calling itself headless.
  if (site === "blocked" || (site === "no-headless" && /HeadlessChrome/.test(String(req.headers["user-agent"])))) { res.statusCode = 403; res.setHeader("content-type", "text/html"); return res.end(DENIED); }
  if (site === "no-headless") site = "evergreen";
  try { res.setHeader("content-type", "text/html"); res.end(readFileSync(join(import.meta.dirname, "..", "fixtures", "sites", site, "index.html"))); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise<void>((r) => sites.listen(0, "127.0.0.1", r));
const SITES = `http://127.0.0.1:${(sites.address() as any).port}`;
const api = createApi({ agent: null }).listen(0, "127.0.0.1");
await new Promise((r) => api.once("listening", r));
const API = `http://127.0.0.1:${(api.address() as any).port}`;
after(() => { sites.close(); api.close(); });

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer() } as { status: number; body: any };
};
const near = (a: string, b: string) => {
  const x = hexToOklch(a), y = hexToOklch(b);
  return Math.abs(x.l - y.l) < 0.03 && Math.abs(x.c - y.c) < 0.03 && Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h)) < 6;
};

let green: any;
test("a green site: its brand colour from buttons, links, theme colour, CSS and logo; pill buttons suggest Material", async () => {
  const r = await call("POST", "/api/brand/captures", { url: `${SITES}/evergreen/` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  green = r.body;
  assert.equal(green.name, "Evergreen Legal");
  const [first] = green.analysis.colours;
  assert.equal(first.hex, "#0b6e4f");
  const sources = first.sources.map((s: any) => s.kind);
  for (const kind of ["buttons", "links", "theme-color", "variable", "logo", "screenshot"]) assert.ok(sources.includes(kind), `seen on ${kind}`);
  assert.ok(green.analysis.colours.some((c: any) => near(c.hex, "#f2a541")), "the second brand colour is found");
  assert.equal(green.analysis.style.designSystem, "material");
  assert.equal(green.designSystem, "material");
  assert.equal(green.analysis.fonts.body, "Roboto");
  const shot = await call("GET", green.screenshot);
  assert.equal(shot.status, 200);
  assert.deepEqual([...new Uint8Array(shot.body).slice(1, 4)], [80, 78, 71], "a PNG screenshot");
});

test("three distinct options, none breaking a colour rule, each with light and dark tokens", () => {
  assert.equal(green.options.length, 3);
  assert.equal(new Set(green.options.map((o: any) => o.id)).size, 3);
  assert.equal(green.options[0].strategy, "faithful", "the closest to the site comes first");
  for (const o of green.options) {
    assert.deepEqual(o.findings.filter((f: any) => f.severity === "error"), [], o.id);
    for (const ap of ["light", "dark"]) {
      assert.match(o.tokens[ap]["piq-color-structure"], /^#[0-9A-F]{6}$/i, `${o.id} ${ap}`);
      assert.equal(o.tokens[ap]["piq-button-radius"], "999px", "Material's pill buttons");
    }
  }
  assert.ok(green.options.some((o: any) => near(o.swatches.light.structure, "#0b6e4f")), "one option keeps the site's own green on its buttons");
});

test("the options move to another design system without reading the site again", async () => {
  const r = await call("GET", `/api/brand/captures/${green.id}?designSystem=carbon`);
  assert.equal(r.status, 200);
  assert.equal(r.body.designSystem, "carbon");
  for (const o of r.body.options) assert.equal(o.tokens.light["piq-button-radius"], "0");
});

test("each design system's style is measured against the theme rules; an option can be adjusted and stays within them", async () => {
  assert.deepEqual(green.styles.map((x: any) => x.name).sort(), ["carbon", "databricks", "fluent", "material"]);
  for (const st of green.styles) for (const f of st.findings) {
    assert.ok(["theme.focus-ring", "theme.small-text-floor", "theme.weights", "theme.families-limited", "theme.surface-separation", "theme.dark-appearance"].includes(f.rule), `${st.name}: ${f.rule}`);
    assert.ok(f.title && f.message);
  }
  assert.ok(green.adjustable.some((r: any) => r.name === "chromaScale" && r.min === 0.5 && r.max === 1.5));
  const base = green.options[0];
  const r = await call("POST", `/api/brand/captures/${green.id}/adjust`, { optionId: base.id, designSystem: "material", adjust: { chromaScale: 0.6, groundLight: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, base.id);
  assert.deepEqual(r.body.adjusted, { chromaScale: 0.6, groundLight: 1 });
  assert.equal(r.body.settings.chromaScale, 0.6);
  assert.notEqual(r.body.swatches.light.structure, base.swatches.light.structure, "a softer brand colour");
  assert.equal(r.body.swatches.light.ground, "#FFFFFF", "a white page");
  assert.deepEqual(r.body.findings.filter((f: any) => f.severity === "error"), []);
  const bad = await call("POST", `/api/brand/captures/${green.id}/adjust`, { optionId: "no-such-option", designSystem: "material", adjust: {} });
  assert.equal(bad.body.code, "ADJUST_FAILED");
  const tooFar = await call("POST", `/api/brand/captures/${green.id}/adjust`, { optionId: "two-colour", designSystem: "material", adjust: { chromaScale: 0.6, groundLight: 1 } });
  if (tooFar.status !== 200) assert.match(tooFar.body.message, /cannot meet the contrast rules \(.+\)/, "a setting the rules cannot meet says why");
});

test("a brand from a logo file: its colours, no screenshot, the default style; an SVG is served so nothing in it runs", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#0b6e4f"/><path d="M20 8 L30 28 H10 Z" fill="#f2a541"/></svg>';
  const r = await call("POST", "/api/brand/captures/logo", { filename: "evergreen-logo.svg", data: Buffer.from(svg).toString("base64") });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.source, "logo");
  assert.equal(r.body.screenshot, null);
  assert.equal(r.body.name, "evergreen");
  assert.equal(r.body.analysis.colours[0].hex, "#0b6e4f");
  assert.ok(r.body.analysis.colours.some((c: any) => c.hex === "#f2a541"));
  assert.equal(r.body.designSystem, "databricks");
  assert.equal(r.body.options.length, 3);
  const file = await fetch(API + r.body.logo);
  assert.equal(file.headers.get("content-type")?.split(";")[0], "image/svg+xml");
  assert.match(String(file.headers.get("content-security-policy")), /default-src 'none'/);
  assert.equal((await call("POST", "/api/brand/captures/logo", { filename: "notes.txt", data: Buffer.from("hello").toString("base64") })).body.code, "LOGO_UNSUPPORTED");
});

test("a red site: red stays the brand's, not the buttons', links' or focus's", async () => {
  const r = await call("POST", "/api/brand/captures", { url: `${SITES}/crimson/` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.analysis.colours[0].hex, "#c8102e");
  assert.equal(r.body.analysis.style.designSystem, "fluent");
  assert.ok(r.body.notes.some((n: string) => /red is kept for errors/.test(n)));
  assert.ok(r.body.options.length >= 1);
  for (const o of r.body.options) for (const ap of ["light", "dark"]) {
    for (const role of ["structure", "accent"]) assert.ok(!isRed(o.tokens[ap][`piq-color-${role}`]), `${o.id} ${ap} ${role} is ${o.tokens[ap][`piq-color-${role}`]}`);
  }
});

let kit: any;
test("the chosen option is kept as a brand kit, with its tokens and a DTCG export", async () => {
  const option = green.options[1];
  const r = await call("POST", "/api/brand/kits", { captureId: green.id, optionId: option.id, designSystem: "material" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  kit = r.body;
  assert.equal(kit.id, "evergreen-legal");
  assert.equal(kit.option.id, option.id);
  const tokens = await call("GET", `/api/brand/kits/${kit.id}/tokens`);
  assert.deepEqual(tokens.body.light["piq-color-structure"], option.tokens.light["piq-color-structure"]);
  const dtcg = await call("GET", `/api/brand/kits/${kit.id}/tokens.json`);
  assert.equal(dtcg.body.primitive.brand["1"].$type, "color");
  assert.equal(dtcg.body.primitive.brand["1"].$value.hex, "#0b6e4f");
  assert.equal(dtcg.body.light.color.structure.$value.colorSpace, "srgb");
  assert.equal(dtcg.body.light.color.structure.$value.components.length, 3);
  assert.deepEqual(dtcg.body.font.body.$value.slice(0, 1), ["Roboto"]);
  const again = await call("POST", "/api/brand/kits", { captureId: green.id, optionId: green.options[0].id, designSystem: "material", adjust: { chromaScale: 0.6 } });
  assert.equal(again.body.id, "evergreen-legal-2", "a second kit of the same name gets its own id");
  assert.deepEqual(again.body.option.adjusted, { chromaScale: 0.6 }, "an adjusted option is kept as adjusted");
  const adjusted = await call("POST", `/api/brand/captures/${green.id}/adjust`, { optionId: green.options[0].id, designSystem: "material", adjust: { chromaScale: 0.6 } });
  assert.equal((await call("GET", `/api/brand/kits/${again.body.id}/tokens`)).body.light["piq-color-structure"], adjusted.body.tokens.light["piq-color-structure"]);
});

test("an app wears a kit; unknown themes and kits are refused; a kit in use cannot be removed", async () => {
  const created = await call("POST", "/api/apps", { name: "Matters" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.definition.id;
  const ops = (args: Record<string, string>) => call("POST", `/api/apps/${id}/operations`, { operations: [{ op: "setLook", args }], summary: "look" });
  assert.equal((await ops({ theme: "no-such-theme" })).body.code, "THEME_UNKNOWN");
  assert.equal((await ops({ brandKit: "no-such-kit" })).body.code, "BRAND_KIT_UNKNOWN");
  const worn = await ops({ brandKit: kit.id, designSystem: "material" });
  assert.equal(worn.status, 200, JSON.stringify(worn.body));
  assert.equal(worn.body.definition.extensions["umf.ux"].look.brandKit, kit.id);
  assert.equal((await call("DELETE", `/api/brand/kits/${kit.id}`)).body.code, "BRAND_KIT_IN_USE");
  const listed = await call("GET", "/api/brand/kits");
  assert.deepEqual(listed.body.kits.find((k: any) => k.id === kit.id).usedBy.map((a: any) => a.id), [id]);
  const started = await call("POST", "/api/apps", { name: "Intake", brandKit: kit.id, designSystem: "material", appearance: "dark" });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.deepEqual(started.body.definition.extensions["umf.ux"].look, { theme: "plain", appearance: "dark", brandKit: kit.id, designSystem: "material" }, "a new app can wear a kit from the start");
  assert.equal((await call("POST", "/api/apps", { name: "Nope", brandKit: "no-such-kit" })).body.code, "BRAND_KIT_UNKNOWN");
  await call("POST", `/api/apps/${started.body.definition.id}/operations`, { operations: [{ op: "setLook", args: { brandKit: "" } }], summary: "look" });
  const off = await ops({ brandKit: "" });
  assert.equal(off.body.definition.extensions["umf.ux"].look.brandKit, undefined);
  assert.equal((await call("DELETE", `/api/brand/kits/${kit.id}`)).status, 200);
});

test("a site that turns away headless browsers is still read; one that refuses every browser is reported, not analysed", async () => {
  const ok = await call("POST", "/api/brand/captures", { url: `${SITES}/no-headless/` });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.analysis.colours[0].hex, "#0b6e4f");
  const refused = await call("POST", "/api/brand/captures", { url: `${SITES}/blocked/` });
  assert.equal(refused.status, 502);
  assert.equal(refused.body.code, "SITE_BLOCKED");
  assert.match(refused.body.message, /turned the studio's browser away \(.*403.*Access Denied/);
  assert.match(refused.body.message, /logo file/);
});

test("a website that cannot be reached is a plain error", async () => {
  const r = await call("POST", "/api/brand/captures", { url: "http://127.0.0.1:9/" });
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "SITE_UNREACHABLE");
  assert.equal((await call("POST", "/api/brand/captures", { url: "ftp://example.com" })).body.code, "URL_INVALID");
});
