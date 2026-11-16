/* The studio's HTTP API (JSON), served on 127.0.0.1 and proxied by Vite under
   /api. The studio UI uses it, and so does the agent, through the UI's own
   controls and rooms (OUI) — never around them. */

import express, { type NextFunction, type Request, type Response } from "express";
import manifest from "@ux-builder/tokens/manifest.json" with { type: "json" };
import { indexDefinition, readSnapshot, runAction, summarize } from "@ux-builder/app-definition";
import { AppError, applyOperations, createAppRecord, createVariant, emitChange, getApp, getVersion, listApps, onAppChange, resetData, restoreVersion } from "./apps.js";
import { appStore, describeDatabase } from "./db.js";
import { compileDeployment, loadUmf } from "./umf.js";
import { schemaFor } from "./db.js";

type AgentRoutes = { mount(app: express.Express): void } | null;

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function createApi({ agent }: { agent: AgentRoutes }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", wrap(async (_req, res) => {
    const { version } = await loadUmf();
    res.json({ ok: true, umf: version, database: await describeDatabase(), agent: !!agent });
  }));

  app.get("/api/themes", (_req, res) => {
    const m = manifest as any;
    res.json({ themes: m.themes.map((t: any) => ({ name: t.name, title: t.title, brand: t.brand, designSystem: t.designSystem, appearances: t.appearances, default: t.default })), designSystems: m.designSystems ?? [] });
  });

  app.get("/api/apps", (_req, res) => { res.json({ apps: listApps() }); });

  app.post("/api/apps", wrap(async (req, res) => {
    const { name, description, useCase, theme, id, definition } = req.body ?? {};
    if (!name && !definition) throw new AppError(400, "NAME_REQUIRED", "Give the app a name");
    const rec = await createAppRecord({ id, name: name ?? definition.extensions["umf.app"].name, description, useCase, theme, definition, by: req.body?.by ?? "person" });
    res.status(201).json(view(rec));
  }));

  app.get("/api/apps/:id", wrap(async (req, res) => { res.json(view(await getApp(String(req.params.id)))); }));

  app.post("/api/apps/:id/operations", wrap(async (req, res) => {
    const { operations, summary, by } = req.body ?? {};
    const rec = await applyOperations(String(req.params.id), operations, { summary, by: by ?? "person" });
    res.json({ ...view(rec), redeployed: rec.redeployed });
  }));

  app.get("/api/apps/:id/versions/:version", wrap(async (req, res) => { res.json({ definition: await getVersion(String(req.params.id), Number(req.params.version)) }); }));
  app.post("/api/apps/:id/versions/:version/restore", wrap(async (req, res) => { res.json(view(await restoreVersion(String(req.params.id), Number(req.params.version), req.body?.by ?? "person"))); }));

  app.post("/api/apps/:id/variants", wrap(async (req, res) => {
    const { id: newId, name, note, by } = req.body ?? {};
    res.status(201).json(view(await createVariant(String(req.params.id), { newId, name, note, by })));
  }));

  /* The UMF-compiled deployment for an app: reviewable SQL, nothing applied. */
  app.get("/api/apps/:id/deployment", wrap(async (req, res) => {
    const { definition } = await getApp(String(req.params.id));
    res.json(await compileDeployment(definition, schemaFor(definition.id)));
  }));

  /* Runtime: what a signed-in person sees and does in the app. */
  const identityOf = (doc: any, who: unknown) => {
    const ids = doc.extensions?.["umf.app"]?.samples?.identities ?? [];
    const found = ids.find((p: any) => p.id === who) ?? ids[0];
    if (!found) throw new AppError(400, "NO_IDENTITY", "This app has no sample people to sign in as yet");
    return found;
  };
  app.get("/api/apps/:id/runtime/snapshot", wrap(async (req, res) => {
    const { definition, version } = await getApp(String(req.params.id));
    const idx = indexDefinition(definition);
    const identity = identityOf(definition, req.query.as);
    const snap = await readSnapshot(idx, appStore(definition), identity, { now: definition.extensions?.["umf.app"]?.samples?.clock });
    res.json({ records: snap.records, now: snap.now, revision: version, identity });
  }));
  app.post("/api/apps/:id/runtime/actions/:action", wrap(async (req, res) => {
    const { definition, version } = await getApp(String(req.params.id));
    const idx = indexDefinition(definition);
    const identity = identityOf(definition, req.body?.as);
    const result = await runAction(idx, appStore(definition), identity, String(req.params.action), req.body?.params ?? {}, { now: definition.extensions?.["umf.app"]?.samples?.clock });
    if (result.ok) emitChange(definition.id, version, "data");
    res.status(result.ok ? 200 : 422).json(result);
  }));
  app.post("/api/apps/:id/runtime/reset", wrap(async (req, res) => {
    await resetData(String(req.params.id));
    res.json({ ok: true });
  }));

  /* Server-sent events: definition and data changes, so every open studio and
     preview refreshes when the agent (or anyone) changes the app. */
  app.get("/api/events", (req, res) => {
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.flushHeaders();
    res.write(`event: hello\ndata: {}\n\n`);
    const off = onAppChange((e) => res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
    req.on("close", () => { off(); clearInterval(ping); });
  });

  agent?.mount(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ ok: false, code: err.code, message: err.message, details: err.details ?? null });
    console.error(err);
    res.status(500).json({ ok: false, code: "INTERNAL", message: String((err as Error)?.message ?? err) });
  });
  return app;
}

function view(rec: { definition: any; verdict: any; version: number; history: any[] }) {
  return {
    definition: rec.definition,
    summary: summarize(rec.definition),
    verdict: { valid: rec.verdict.valid, renderable: rec.verdict.renderable, errors: rec.verdict.errors, warnings: rec.verdict.unaccepted },
    version: rec.version,
    history: rec.history,
  };
}
