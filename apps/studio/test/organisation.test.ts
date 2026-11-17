/* Apps on the organisation's data: people sign in through the sample
   organisation's identity provider (OpenID Connect, on this machine), browse
   its data catalog (a Unity Catalog stand-in) and make reporting and data
   management apps on it. The catalog answers as each person: its grants, row
   filters and column masks decide what they see and may change, and no app
   can widen that. Apps are private to their owner until shared. */
process.env.STUDIO_PG_MEMORY = "1";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const freePort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });
const [apiPort, idpPort, catalogPort] = [await freePort(), await freePort(), await freePort()];
process.env.STUDIO_DATA_DIR = join(mkdtempSync(join(tmpdir(), "studio-org-")), ".data");
process.env.STUDIO_AUTH = "local";
process.env.STUDIO_IDP_PORT = String(idpPort);
process.env.STUDIO_CATALOG_PORT = String(catalogPort);
process.env.STUDIO_PUBLIC_URL = `http://127.0.0.1:${apiPort}`;
const { createApi } = await import("../server/api.ts");
const { startOrganisation } = await import("../server/organisation.ts");
const org = await startOrganisation();
const api = createApi({ agent: null, auth: org.auth }).listen(apiPort, "127.0.0.1");
await new Promise((r) => api.once("listening", r));
const API = `http://127.0.0.1:${apiPort}`;
after(async () => { api.close(); await org.close(); });

/* Sign in as a sample person, the way a browser does: follow the redirects, keeping each host's cookies. */
async function signIn(person: string) {
  const jars = new Map<string, Map<string, string>>();
  const jar = (u: URL) => jars.get(u.host) ?? (jars.set(u.host, new Map()), jars.get(u.host)!);
  const send = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const cookie = [...jar(u)].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar(u).set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
    return res;
  };
  let res = await send(`${API}/api/auth/login?return=/`);
  for (let hops = 0; hops < 12; hops++) {
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, res.url || API).href;
      if (new URL(next).host === new URL(API).host && new URL(next).pathname === "/") break;
      res = await send(next);
      continue;
    }
    const html = await res.text();
    const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1];
    assert.ok(action, `expected the sign-in page, got ${res.status}: ${html.slice(0, 200)}`);
    res = await send(new URL(action, `http://127.0.0.1:${idpPort}`).href, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `person=${person}` });
  }
  const session = jar(new URL(API)).get("studio_session");
  assert.ok(session, `${person} has a studio session`);
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(API + path, { method, headers: { cookie: `studio_session=${session}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
}

test("without signing in, the studio answers only that you need to", async () => {
  const r = await fetch(`${API}/api/apps`);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, "SIGNED_OUT");
});

let alex: Awaited<ReturnType<typeof signIn>>, priya: typeof alex, sam: typeof alex, casey: typeof alex;
test("people sign in through the organisation's identity provider, with their groups", async () => {
  [alex, priya, sam, casey] = [await signIn("alex"), await signIn("priya"), await signIn("sam"), await signIn("casey")];
  const me = (await priya("GET", "/api/me")).body;
  assert.equal(me.user.name, "Priya Shah");
  assert.deepEqual(me.user.groups, ["litigation", "studio-builders"]);
  assert.equal(me.user.builder, true);
  assert.equal((await casey("GET", "/api/me")).body.user.builder, false);
});

test("the catalog shows each person only what they may read, and says what they may change", async () => {
  const tables = (tree: any[]) => Object.fromEntries(tree.flatMap((c) => c.schemas.flatMap((s: any) => s.tables.map((t: any) => [t.fullName, t.access]))));
  const p = tables((await priya("GET", "/api/catalog/tree")).body.tree);
  assert.deepEqual(Object.keys(p).sort(), ["harbor.finance.time_entries", "harbor.practice.clients", "harbor.practice.matters"]);
  assert.equal(p["harbor.practice.clients"].change, false);
  const s = tables((await sam("GET", "/api/catalog/tree")).body.tree);
  assert.ok(s["harbor.finance.invoices"].change && s["harbor.practice.clients"].change);
  assert.equal(s["harbor.practice.clients"].changeVia, "data-stewards");
  const matters = (await priya("GET", "/api/catalog/tables/harbor.practice.matters")).body;
  assert.match(matters.rowFilter.comment, /their own practice group/);
  assert.match(matters.columns.find((c: any) => c.name === "budget").mask.comment, /partners and finance/);
  assert.deepEqual(matters.columns.find((c: any) => c.name === "status").values, ["open", "on hold", "closed"]);
  assert.equal((await priya("GET", "/api/catalog/tables/harbor.people.employees")).status, 404);
});

let report: any;
test("a reporting app on the catalog: rows are the catalog's, filtered and masked for whoever is looking", async () => {
  const r = await alex("POST", "/api/apps", { name: "Matter dashboard", kind: "reporting", sources: [{ asset: "harbor.practice.matters" }, { asset: "harbor.practice.clients" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  report = r.body.definition;
  assert.equal(r.body.verdict.valid, true, JSON.stringify(r.body.verdict.errors));
  assert.deepEqual(r.body.summary.sources.map((s: any) => s.asset), ["harbor.practice.matters", "harbor.practice.clients"]);
  assert.ok(r.body.definition.extensions["umf.ux"].screens.some((s: any) => s.regions.some((x: any) => x.kind === "chart")));
  const asAlex = (await alex("GET", `/api/apps/${report.id}/runtime/snapshot`)).body;
  assert.equal(asAlex.records.matters.length, 48);
  assert.ok(asAlex.records.matters.every((m: any) => typeof m.budget === "number"));
  assert.equal(asAlex.identity.name, "Alex Morgan");

  // Private until shared.
  assert.equal((await priya("GET", `/api/apps/${report.id}`)).status, 404);
  const shared = await alex("PUT", `/api/apps/${report.id}/access`, { users: ["group:litigation"], editors: [] });
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
  const asPriya = (await priya("GET", `/api/apps/${report.id}/runtime/snapshot`)).body;
  assert.ok(asPriya.records.matters.length > 0 && asPriya.records.matters.length < 48);
  assert.ok(asPriya.records.matters.every((m: any) => m.practice_group === "litigation"), "only her practice group's matters");
  assert.ok(asPriya.records.matters.every((m: any) => m.budget === null), "budgets are masked for her");
  assert.equal((await priya("POST", `/api/apps/${report.id}/operations`, { operations: [{ op: "setShell", args: { title: "Mine now" } }] })).status, 403);
});

test("an app can't ask for more than the person has: no change access to a table they can only read", async () => {
  const r = await priya("POST", "/api/apps", { name: "Client fixer", kind: "data-management", sources: [{ asset: "harbor.practice.clients", access: "change" }] });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /can read harbor.practice.clients but not change it/);
  assert.equal((await casey("POST", "/api/apps", { name: "Anything" })).status, 403);
});

test("a data management app: the people who may change the table change it, in the catalog, as themselves", async () => {
  const r = await sam("POST", "/api/apps", { name: "Client records", kind: "data-management", sources: [{ asset: "harbor.practice.clients", access: "change" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const app = r.body.definition;
  assert.equal(r.body.verdict.valid, true, JSON.stringify(r.body.verdict.errors));
  const roles = app.extensions["umf.app"].roles;
  assert.deepEqual(roles.find((x: any) => x.id === "editor").groups, ["data-stewards"]);
  const before = (await sam("GET", `/api/apps/${app.id}/runtime/snapshot`)).body;
  assert.ok(before.identity.roles.includes("editor"));
  const client = before.records.clients[0];
  const edit = await sam("POST", `/api/apps/${app.id}/runtime/actions/edit-clients`, { params: { target: client.client_id, name: client.name, industry: client.industry, city: client.city, contact_name: "Robin Ashe", contact_email: client.contact_email, phone: client.phone, status: client.status } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const rows = (await sam("GET", `/api/catalog/tables/harbor.practice.clients/rows?limit=200`)).body.rows;
  assert.equal(rows.find((x: any) => x.client_id === client.client_id).contact_name, "Robin Ashe", "the change is in the catalog");

  // Shared with litigation as an editor: Priya may open it, but the catalog still refuses her change.
  await sam("PUT", `/api/apps/${app.id}/access`, { users: [], editors: ["group:litigation"] });
  const tryIt = await priya("POST", `/api/apps/${app.id}/runtime/actions/edit-clients`, { as: "role:editor", params: { target: client.client_id, name: client.name, contact_name: "Someone Else" } });
  assert.equal(tryIt.status, 422);
  assert.equal(tryIt.body.code, "FORBIDDEN");
  assert.match(tryIt.body.message, /may not change client in the data catalog/i);
});

test("each person's conversations and apps are their own", async () => {
  const mine = (await priya("GET", "/api/apps")).body.apps.map((a: any) => a.name).sort();
  assert.deepEqual(mine, ["Client records", "Matter dashboard"]);
  assert.deepEqual((await casey("GET", "/api/apps")).body.apps, []);
});
