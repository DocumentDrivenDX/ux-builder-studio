/* UMF, as the studio server uses it: the SDK (installed by scripts/setup-umf.mjs
   from UMF's GitHub release), one registry carrying UMF's own vocabularies plus
   umf.app and umf.ux, document validation into the studio's verdict, and table
   deployment SQL compiled by UMF from umf.tables declarations. */

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { checkProfile, verdict } from "@ux-builder/app-definition";
import type { AppDefinition } from "@ux-builder/app-runtime/contract";

const here = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = process.env.UMF_SDK_DIR ?? join(here, "..", ".umf");

export type Diagnostic = { code: string; path: string; message: string; severity: "error" | "warning" };
export type Verdict = ReturnType<typeof verdict>;
type Validation = { valid: boolean; complete: boolean; diagnostics: Diagnostic[] };

/* UMF runs in its own thread (umf-worker.ts); this side keeps the caches and
   speaks to it by message. */
type UmfWorker = { call(msg: Record<string, unknown>): Promise<any>; version: string };
let worker: UmfWorker | null = null;
let starting: Promise<UmfWorker> | null = null;

export function loadUmf() {
  if (worker) return Promise.resolve(worker);
  return (starting ??= new Promise<UmfWorker>((resolve, reject) => {
    const w = new Worker(new URL("./umf-worker.mjs", import.meta.url), { workerData: { sdkDir: SDK_DIR }, execArgv: [] });
    // Referenced while it starts or has calls in flight, so a script waiting on
    // UMF stays alive; unreferenced when idle, so it never keeps a process running.
    const pending = new Map<number, (r: any) => void>();
    let seq = 0;
    w.on("message", (m: any) => {
      if ("ready" in m) {
        if (!m.ready) return reject(new Error(m.error));
        worker = {
          version: m.version,
          call: (msg) => new Promise((res) => {
            const id = ++seq;
            if (pending.size === 0) w.ref();
            pending.set(id, res);
            w.postMessage({ ...msg, id });
          }),
        };
        w.unref();
        return resolve(worker);
      }
      pending.get(m.id)?.(m);
      pending.delete(m.id);
      if (pending.size === 0) w.unref();
    });
    w.on("error", reject);
    w.on("exit", (code) => { if (!worker) reject(new Error(`UMF's worker exited (${code}) before it was ready`)); });
  }));
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const verdicts = new Map<string, Verdict>();
const actionValidations = new Map<string, Validation>();

async function validateIn(op: "validate" | "validateActions", doc: unknown): Promise<Validation> {
  const umf = await loadUmf();
  const r = await umf.call({ op, doc });
  return r.ok ? r.value : { valid: false, complete: false, diagnostics: [{ ...r.error, severity: "error" }] };
}

/* Validate an app definition: app profile 0.1, then UMF (core, umf.app, umf.ux,
   and umf.actions). Verdicts are cached by the definition's content. */
export async function validateDefinition(doc: AppDefinition): Promise<Verdict> {
  const key = hash(doc);
  const cached = verdicts.get(key);
  if (cached) return cached;
  const profile = checkProfile(doc);
  const actionsDoc = { umf: doc.umf, id: "app-actions", vocabularies: { "umf.actions": doc.vocabularies["umf.actions"] }, modules: doc.modules };
  const akey = hash(actionsDoc);
  const hasActions = doc.modules.some((m: any) => (m.extensions?.["umf.actions"]?.actions ?? []).length > 0);
  const [main, actions] = await Promise.all([
    // Pass 1: core, umf.app and umf.ux (umf.actions is pass 2, so its "unknown here" notice is not a finding).
    validateIn("validate", doc).then((v) => ({ ...v, diagnostics: v.diagnostics.filter((d) => !(d.code === "UNKNOWN_EXTENSION" && d.path === "/vocabularies/umf.actions")) })),
    // Pass 2: UMF's umf.actions validator, on the records and actions only, once per change to them.
    actionValidations.get(akey) ?? (hasActions ? validateIn("validateActions", actionsDoc).then((v) => (actionValidations.set(akey, v), v)) : Promise.resolve({ valid: true, complete: true, diagnostics: [] as Diagnostic[] })),
  ]);
  const combined = {
    valid: main.valid && actions.valid,
    complete: main.complete && actions.complete,
    diagnostics: [...main.diagnostics, ...actions.diagnostics.filter((d) => !main.diagnostics.some((m) => m.code === d.code && m.path === d.path))],
  };
  const result = verdict(combined, profile);
  verdicts.set(key, result);
  return result;
}

const NATIVE: Record<string, (f: any) => Record<string, unknown>> = {
  string: () => ({ kind: "text" }),
  integer: () => ({ kind: "int8" }),
  decimal: (f) => ({ kind: "numeric", precision: f.facets?.precision ?? 18, scale: f.facets?.scale ?? 4 }),
  float: () => ({ kind: "float8" }),
  boolean: () => ({ kind: "boolean" }),
  date: () => ({ kind: "date" }),
  timestamp: () => ({ kind: "timestamptz" }),
  time: () => ({ kind: "text" }),
  uuid: () => ({ kind: "uuid" }),
};

const allow = { kind: "allow" };
const deny = { kind: "deny" };

/* The physical side of an app: a copy of the definition with umf.tables
   declarations for every record (columns, primary key, foreign keys and a
   row-level policy), which UMF compiles to PostgreSQL 18 SQL. The definition
   itself stays logical; this is derived per deployment. */
export function withTables(doc: AppDefinition) {
  const d = structuredClone(doc) as any;
  const m = d.modules[0];
  const els = new Map<string, any>(m.elements.map((e: any) => [e.id, e]));
  const fks: any[] = d.extensions?.["umf.app"]?.foreignKeys ?? [];
  const rels = new Map<string, any>((m.relationships ?? []).map((r: any) => [r.id, r]));
  const tables = m.elements
    .filter((e: any) => e.kind === "record")
    .map((rec: any) => ({
      id: rec.id,
      record: { module: m.id, element: rec.id },
      name: rec.id,
      columns: rec.members.map((mr: any) => {
        const f = els.get(mr.element);
        return { field: { module: m.id, element: f.id }, name: f.name ?? f.id, nativeType: (NATIVE[f.scalarType] ?? NATIVE.string)(f) };
      }),
      indexes: [],
      checks: [],
      foreignKeys: fks
        .filter((fk) => rels.get(fk.relationship)?.source?.[0]?.element === rec.id)
        .map((fk, i) => {
          const rel = rels.get(fk.relationship);
          return {
            id: `fk_${i}`,
            name: `${rec.id}_${fk.field.element.split("__")[1] ?? fk.field.element}_fk`.slice(0, 63),
            fields: [fk.field],
            target: { record: { module: m.id, element: rel.target[0].element }, key: rel.target[0].key ?? "pk" },
            onUpdate: "noAction",
            onDelete: "restrict",
            deferrable: false,
          };
        }),
      // The studio runtime enforces umf.app access rules per person; the database
      // grants its person role full access and refuses batch writes.
      policy: { mode: "native-rls", person: { select: allow, insert: allow, update: allow, delete: allow }, batch: { select: allow, insert: deny, update: deny, delete: deny } },
    }));
  // UMF's table compiler sees only what it deploys: core records and relationships plus umf.tables.
  d.vocabularies = { "umf.tables": { version: "0.1.0" } };
  delete d.extensions;
  m.extensions = { "umf.tables": { profile: "postgresql18/0.1", tables, seedSets: [], commands: [] } };
  return d;
}

export type Deployment = { schema: string; roles: string[]; steps: Array<{ id: string; kind: string; sql: string }>; digest: string };

const deployments = new Map<string, Deployment>();

/* UMF's table compiler is CPU-heavy; a definition's deployment never changes, so
   compile it once (when the version is saved) and serve that afterwards. */
export async function compileDeployment(doc: AppDefinition, schema: string): Promise<Deployment> {
  const key = `${schema}:${hash([doc.modules, doc.extensions?.["umf.app"]?.foreignKeys])}`;
  const cached = deployments.get(key);
  if (cached) return cached;
  const result = await compileDeploymentUncached(doc, schema);
  deployments.set(key, result);
  return result;
}

async function compileDeploymentUncached(doc: AppDefinition, schema: string): Promise<Deployment> {
  const umf = await loadUmf();
  const physical = withTables(doc);
  const role = (s: string) => `${schema}_${s}`.slice(0, 63);
  const configuration = { module: physical.modules[0].id, schema, ownerRole: role("owner"), personRole: role("person"), batchRole: role("batch"), groupRoles: {} };
  const reply = await umf.call({ op: "compile", text: JSON.stringify(physical), configuration });
  if (!reply.ok) throw Object.assign(new Error(`UMF could not compile the table deployment: ${reply.error.message}`), { code: "DEPLOYMENT_BLOCKED" });
  const result = reply.value;
  if (result.status !== "compiled") {
    const why = (result.diagnostics ?? []).map((d: any) => `${d.code ?? ""} ${d.path ?? ""} ${d.message ?? ""}`.trim()).join("; ");
    throw Object.assign(new Error(`UMF could not compile the table deployment: ${why}`), { code: "DEPLOYMENT_BLOCKED", diagnostics: result.diagnostics });
  }
  return {
    schema,
    roles: [configuration.ownerRole, configuration.personRole, configuration.batchRole],
    steps: result.bundle.steps.map((s: any) => ({ id: s.id, kind: s.kind, sql: s.sql })),
    digest: result.bundle.bundleDigest,
  };
}
