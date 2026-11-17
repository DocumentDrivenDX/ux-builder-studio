/* The studio's HTTP API (JSON), served on 127.0.0.1 and proxied by Vite under
   /api. The studio UI uses it, and so does the agent, through the UI's own
   controls and rooms (OUI) — never around them.

   Everything but signing in needs a signed-in person (auth.ts). What they
   may do with an app is the app's sharing (access.ts); what they may see of
   the organisation's data is the data catalog's own answer, asked as them. */

import express, { type NextFunction, type Request, type Response } from "express";
import manifest from "@ux-builder/tokens/manifest.json" with { type: "json" };
import { indexDefinition, readSnapshot, runAction, summarize } from "@ux-builder/app-definition";
import type { AppDefinition } from "@ux-builder/app-runtime/contract";
import { AppError, applyOperations, createAppRecord, createVariant, emitChange, getApp, getVersion, listApps, onAppChange, resetData, restoreVersion, type Operation } from "./apps.js";
import { appStore, describeDatabase } from "./db.js";
import { compileDeployment, loadUmf } from "./umf.js";
import { schemaFor } from "./db.js";
import { mountBrand } from "./brand/routes.js";
import { Auth, userOf, type User } from "./auth.js";
import { canEdit, canShare, canUse, isOwner, readAccess, validPrincipal, writeAccess, type AppAccess } from "./access.js";
import { catalogFor, catalogInfo, describeTable, mountCatalog } from "./catalog/service.js";
import { accessProblem, scaffoldOperations, sourceArgs, type Kind } from "./catalog/scaffold.js";
import { liveStore } from "./catalog/store.js";
import { CatalogError } from "./catalog/unity.js";
import { GROUPS, PEOPLE } from "./org/sample-org.js";

type AgentRoutes = { mount(app: express.Express): void } | null;

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const NO_AUTH = new Auth({ mode: "none", issuer: null, clientId: null, clientSecret: null, groupsClaim: "groups", builderGroups: ["studio-builders"], publicUrl: "", resource: null, label: "No sign-in" });

export function createApi({ agent, auth = NO_AUTH }: { agent: AgentRoutes; auth?: Auth }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", wrap(async (_req, res) => {
    const { version } = await loadUmf();
    res.json({ ok: true, umf: version, database: await describeDatabase(), agent: !!agent, auth: auth.config.mode, catalog: catalogInfo().available });
  }));
  auth.mount(app);
  app.use(auth.guard());

  app.get("/api/themes", (_req, res) => {
    const m = manifest as any;
    res.json({ themes: m.themes.map((t: any) => ({ name: t.name, title: t.title, brand: t.brand, designSystem: t.designSystem, appearances: t.appearances, default: t.default })), designSystems: m.designSystems ?? [] });
  });

  /* The organisation's groups and people, for sharing and for roles. With the
     organisation's own sign-in the studio knows only the groups of the people
     who have signed in, so sharing with others is by typed name. */
  app.get("/api/directory", (req, res) => {
    if (auth.config.mode === "local") return res.json({ groups: GROUPS.map((g) => ({ id: g.id, name: g.name, description: g.description })), people: PEOPLE.map((p) => ({ email: p.email, name: p.name, title: p.title })) });
    const u = userOf(req);
    res.json({ groups: u.groups.map((g) => ({ id: g, name: g, description: "" })), people: [{ email: u.email, name: u.name, title: "" }] });
  });

  /* ---------- apps and who may use them ---------- */

  const accessOf = (id: string) => readAccess(id);
  const mayUse = (req: Request, id: string) => {
    const a = accessOf(id);
    if (!canUse(userOf(req), a)) throw new AppError(404, "APP_NOT_FOUND", `There is no app ${id}`);
    return a;
  };
  const mayEdit = (req: Request, id: string) => {
    const a = mayUse(req, id);
    const u = userOf(req);
    if (!canEdit(u, a)) throw new AppError(403, "READ_ONLY", u.builder ? "You may use this app, but not change it; ask its owner to make you an editor" : "Only studio builders may change apps");
    return a;
  };
  const rights = (u: User, a: AppAccess) => ({ owner: a.owner, edit: canEdit(u, a), share: canShare(u, a), mine: isOwner(u, a) });

  app.get("/api/apps", (req, res) => {
    const u = userOf(req);
    res.json({ apps: listApps().map((x) => ({ ...x, access: rights(u, accessOf(x.id)) })).filter((x) => canUse(u, accessOf(x.id))), me: u });
  });

  app.post("/api/apps", wrap(async (req, res) => {
    const u = userOf(req);
    if (!u.builder) throw new AppError(403, "NOT_A_BUILDER", "Only studio builders may make apps");
    const { name, description, useCase, theme, brandKit, designSystem, appearance, id, definition, kind, sources } = req.body ?? {};
    if (!name && !definition) throw new AppError(400, "NAME_REQUIRED", "Give the app a name");
    let operations: Operation[] = [];
    if (kind === "reporting" || kind === "data-management") {
      // An app on the organisation's data starts from the tables chosen, read as the person.
      const wanted: Array<{ asset: string; access?: "read" | "change" }> = Array.isArray(sources) ? sources : [];
      if (!wanted.length) throw new AppError(400, "SOURCES_REQUIRED", "Choose at least one table from the data catalog");
      const { catalog, token, user } = catalogFor(req);
      const chosen = [];
      for (const w of wanted) {
        const access = kind === "reporting" ? "read" : w.access === "change" ? "change" : "read";
        const table = await describeTable(catalog, token, user, String(w.asset));
        const problem = accessProblem(table, access);
        if (problem) throw new AppError(403, "CATALOG_ACCESS", problem);
        chosen.push({ table, access } as const);
      }
      if (kind === "data-management" && !chosen.some((c) => c.access === "change")) throw new AppError(400, "NOTHING_TO_CHANGE", "A data management app changes at least one table; choose one you may change");
      operations = scaffoldOperations({ kind: kind as Kind, chosen, appName: name, user: u }) as Operation[];
    }
    const rec = await createAppRecord({ id, name: name ?? definition.extensions["umf.app"].name, description, useCase, theme, brandKit, designSystem, appearance, definition, by: req.body?.by ?? "person", operations, kind: kind === "own-data" ? "own-data" : undefined });
    writeAccess(rec.definition.id, { owner: u.email, editors: [], users: [] });
    res.status(201).json(view(rec, u));
  }));

  app.get("/api/apps/:id", wrap(async (req, res) => {
    mayUse(req, String(req.params.id));
    res.json(view(await getApp(String(req.params.id)), userOf(req)));
  }));

  app.get("/api/apps/:id/access", wrap(async (req, res) => {
    const a = mayUse(req, String(req.params.id));
    res.json({ access: a, rights: rights(userOf(req), a) });
  }));
  app.put("/api/apps/:id/access", wrap(async (req, res) => {
    const id = String(req.params.id);
    const a = mayUse(req, id);
    const u = userOf(req);
    if (!canShare(u, a)) throw new AppError(403, "NOT_OWNER", "Only the app's owner may share it");
    const clean = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(validPrincipal))];
    const next: AppAccess = { owner: a.owner ?? u.email, editors: clean(req.body?.editors), users: clean(req.body?.users) };
    writeAccess(id, next);
    res.json({ access: next, rights: rights(u, next) });
  }));

  app.post("/api/apps/:id/operations", wrap(async (req, res) => {
    const id = String(req.params.id);
    mayEdit(req, id);
    const { operations, summary, by } = req.body ?? {};
    const resolved = await resolveSources(req, operations);
    const rec = await applyOperations(id, resolved, { summary, by: by ?? "person" });
    res.json({ ...view(rec, userOf(req)), redeployed: rec.redeployed });
  }));

  app.get("/api/apps/:id/versions/:version", wrap(async (req, res) => {
    mayUse(req, String(req.params.id));
    res.json({ definition: await getVersion(String(req.params.id), Number(req.params.version)) });
  }));
  app.post("/api/apps/:id/versions/:version/restore", wrap(async (req, res) => {
    mayEdit(req, String(req.params.id));
    res.json(view(await restoreVersion(String(req.params.id), Number(req.params.version), req.body?.by ?? "person"), userOf(req)));
  }));

  app.post("/api/apps/:id/variants", wrap(async (req, res) => {
    const u = userOf(req);
    mayUse(req, String(req.params.id));
    if (!u.builder) throw new AppError(403, "NOT_A_BUILDER", "Only studio builders may make apps");
    const { id: newId, name, note, by } = req.body ?? {};
    const rec = await createVariant(String(req.params.id), { newId, name, note, by });
    writeAccess(rec.definition.id, { owner: u.email, editors: [], users: [] });
    res.status(201).json(view(rec, u));
  }));

  /* The UMF-compiled deployment for an app: reviewable SQL, nothing applied. */
  app.get("/api/apps/:id/deployment", wrap(async (req, res) => {
    mayUse(req, String(req.params.id));
    const { definition } = await getApp(String(req.params.id));
    res.json(await compileDeployment(definition, schemaFor(definition.id)));
  }));

  /* ---------- running an app ---------- */

  /* Who is using the app. On sample data: one of its sample people. On the
     organisation's data: the signed-in person, with the roles their groups
     give them; someone who may change the app can try it with one role
     ("as"), but the catalog still answers as them. */
  const identityOf = (req: Request, doc: AppDefinition, who: unknown) => {
    const idx = indexDefinition(doc);
    if (idx.sources.size) {
      const u = userOf(req);
      const roles: string[] = (doc.extensions?.["umf.app"]?.roles ?? []).filter((r: any) => (r.groups ?? []).some((g: string) => u.groups.includes(g))).map((r: any) => r.id);
      const tryRole = typeof who === "string" && who.startsWith("role:") ? who.slice(5) : null;
      const a = accessOf(doc.id);
      const asRole = tryRole && canEdit(u, a) && (doc.extensions?.["umf.app"]?.roles ?? []).some((r: any) => r.id === tryRole) ? [tryRole] : null;
      const effective = asRole ?? (roles.length ? roles : canEdit(u, a) ? (doc.extensions?.["umf.app"]?.roles ?? []).map((r: any) => r.id) : []);
      return { id: u.email, name: u.name, email: u.email, roles: effective, attributes: { groups: u.groups }, live: true, ...(asRole ? { note: `Trying the app as ${tryRole}` } : !roles.length && effective.length ? { note: "None of your groups has a role in this app; as someone who can change it, you see every role" } : {}) };
    }
    const ids = doc.extensions?.["umf.app"]?.samples?.identities ?? [];
    const found = ids.find((p: any) => p.id === who) ?? ids[0];
    if (!found) throw new AppError(400, "NO_IDENTITY", "This app has no sample people to sign in as yet");
    return found;
  };
  const storeFor = (req: Request, doc: AppDefinition) => {
    if (!indexDefinition(doc).sources.size) return { store: appStore(doc), reports: null };
    let access = null;
    try { access = catalogFor(req); } catch { access = null; }
    const s = liveStore(doc, appStore(doc), access);
    return { store: s, reports: s.reports };
  };
  const clockOf = (doc: AppDefinition) => (indexDefinition(doc).sources.size ? undefined : doc.extensions?.["umf.app"]?.samples?.clock);

  app.get("/api/apps/:id/runtime/snapshot", wrap(async (req, res) => {
    mayUse(req, String(req.params.id));
    const { definition, version } = await getApp(String(req.params.id));
    const idx = indexDefinition(definition);
    const identity = identityOf(req, definition, req.query.as);
    const { store, reports } = storeFor(req, definition);
    const snap = await readSnapshot(idx, store, identity, { now: clockOf(definition) }).catch(catalogProblem);
    res.json({ records: snap.records, now: snap.now, revision: version, identity, ...(reports ? { sources: [...reports.values()] } : {}) });
  }));
  app.post("/api/apps/:id/runtime/actions/:action", wrap(async (req, res) => {
    mayUse(req, String(req.params.id));
    const { definition, version } = await getApp(String(req.params.id));
    const idx = indexDefinition(definition);
    const identity = identityOf(req, definition, req.body?.as);
    const { store } = storeFor(req, definition);
    const result = await runAction(idx, store, identity, String(req.params.action), req.body?.params ?? {}, { now: clockOf(definition) }).catch((e: any) => {
      if (e?.code && /^(FORBIDDEN|NOT_FOUND|NO_CATALOG|CATALOG_|PERMISSION_DENIED|DUPLICATE_KEY)/.test(e.code)) return { ok: false as const, code: e.code, message: e.message };
      throw e;
    });
    if (result.ok) emitChange(definition.id, version, "data");
    res.status(result.ok ? 200 : 422).json(result);
  }));
  app.post("/api/apps/:id/runtime/reset", wrap(async (req, res) => {
    mayEdit(req, String(req.params.id));
    await resetData(String(req.params.id));
    res.json({ ok: true });
  }));

  /* Server-sent events: definition and data changes, so every open studio and
     preview refreshes when the agent (or anyone) changes the app. */
  app.get("/api/events", (req, res) => {
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.flushHeaders();
    res.write(`event: hello\ndata: {}\n\n`);
    const u = userOf(req);
    const off = onAppChange((e) => { if (canUse(u, accessOf(e.appId))) res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`); });
    const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
    req.on("close", () => { off(); clearInterval(ping); });
  });

  mountCatalog(app);
  mountBrand(app);
  agent?.mount(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ ok: false, code: err.code, message: err.message, details: err.details ?? null });
    if (err instanceof CatalogError) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ ok: false, code: err.code, message: err.message });
    console.error(err);
    res.status(500).json({ ok: false, code: "INTERNAL", message: String((err as Error)?.message ?? err) });
  });
  return app;
}

/* A catalog that refuses or can't be reached, said plainly. */
function catalogProblem(e: any): never {
  if (e instanceof CatalogError) throw e;
  if (e?.code && /^(FORBIDDEN|NO_CATALOG|CATALOG_)/.test(e.code)) throw new AppError(e.code === "NO_CATALOG" ? 401 : 403, e.code, e.message);
  throw e;
}

/* addSource operations name a table; the studio reads its columns from the
   catalog as the person, and refuses what they couldn't do themselves. */
async function resolveSources(req: Request, operations: Operation[]): Promise<Operation[]> {
  if (!Array.isArray(operations) || !operations.some((o) => o?.op === "addSource")) return operations;
  const { catalog, token, user } = catalogFor(req);
  const out: Operation[] = [];
  for (const o of operations) {
    if (o?.op !== "addSource") { out.push(o); continue; }
    const args = (o.args ?? {}) as { asset?: string; access?: "read" | "change"; record?: string; title?: string; description?: string; limit?: number };
    const access = args.access === "change" ? "change" : "read";
    const table = await describeTable(catalog, token, user, String(args.asset ?? ""));
    const problem = accessProblem(table, access);
    if (problem) throw new AppError(403, "CATALOG_ACCESS", `${problem}; nothing was saved`);
    const base = sourceArgs(table, access);
    out.push({ op: "addSource", args: { ...base, ...(args.record ? { record: args.record } : {}), ...(args.title ? { title: args.title } : {}), ...(args.description ? { description: args.description } : {}), ...(args.limit ? { limit: args.limit } : {}) } });
  }
  return out;
}

function view(rec: { definition: any; verdict: any; version: number; history: any[] }, user?: User) {
  const a = readAccess(rec.definition.id);
  return {
    definition: rec.definition,
    summary: summarize(rec.definition),
    verdict: { valid: rec.verdict.valid, renderable: rec.verdict.renderable, errors: rec.verdict.errors, warnings: rec.verdict.unaccepted },
    version: rec.version,
    history: rec.history,
    ...(user ? { access: { owner: a.owner, edit: canEdit(user, a), share: canShare(user, a), mine: isOwner(user, a) } } : {}),
  };
}
