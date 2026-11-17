/* The studio's apps: each is a UMF app definition with a version history,
   stored as files under apps/studio/.data/apps/<id>/. Every change goes
   through the typed operations of @ux-builder/app-definition, then UMF
   validation; a change that makes the definition invalid is refused and
   nothing is saved. When a change touches the data model or the samples, the
   app's Postgres schema is redeployed from UMF's SQL. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, createApp, makeVariant, OpError, OPERATION_SCHEMAS, putScreen, setLook, setNavigation, summarize } from "@ux-builder/app-definition";
import Ajv from "ajv";
import manifest from "@ux-builder/tokens/manifest.json" with { type: "json" };
import type { AppDefinition } from "@ux-builder/app-runtime/contract";
import { kitExists } from "./brand/store.js";
import { deployApp, schemaExists } from "./db.js";
import { validateDefinition, type Verdict } from "./umf.js";

/* An app's look must name a theme ux-builder ships and, if it uses one, a
   brand kit in the studio's library; otherwise it would render unstyled. */
const THEMES: string[] = (manifest as any).themes.map((t: any) => t.name);
function checkLook(doc: AppDefinition, previous?: AppDefinition) {
  const look = doc.extensions?.["umf.ux"]?.look ?? {};
  if (previous && JSON.stringify(previous.extensions?.["umf.ux"]?.look ?? {}) === JSON.stringify(look)) return;
  if (look.theme && !THEMES.includes(look.theme)) throw new AppError(422, "THEME_UNKNOWN", `There is no theme ${look.theme}; choose one of ${THEMES.join(", ")}; nothing was saved`);
  if (look.brandKit && !kitExists(look.brandKit)) throw new AppError(422, "BRAND_KIT_UNKNOWN", `There is no brand kit ${look.brandKit} in the studio's library; nothing was saved`);
}

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(process.env.STUDIO_DATA_DIR ?? join(here, "..", ".data"), "apps");

export type Operation = { op: string; args?: Record<string, unknown> };
export type VersionMeta = { version: number; at: string; by: string; summary: string; operations: Operation[] };
export type AppRecord = { definition: AppDefinition; verdict: Verdict; version: number; history: VersionMeta[] };

const ajv = new Ajv({ allErrors: true, strict: false });
const argValidators: Record<string, ReturnType<typeof ajv.compile>> = Object.fromEntries(
  Object.entries(OPERATION_SCHEMAS as Record<string, { args: object }>).map(([k, v]) => [k, ajv.compile(v.args)]),
);

const dirOf = (id: string) => join(ROOT, id.replace(/[^a-z0-9.-]/gi, "_"));
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8"));
const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};

const dataHash = (doc: AppDefinition) =>
  createHash("sha256").update(JSON.stringify([doc.modules, doc.extensions?.["umf.app"]?.samples, doc.extensions?.["umf.app"]?.foreignKeys, doc.extensions?.["umf.app"]?.sources])).digest("hex");

const listeners = new Set<(event: { appId: string; version: number; kind: "definition" | "data" }) => void>();
export const onAppChange = (l: (e: { appId: string; version: number; kind: "definition" | "data" }) => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const emitChange = (appId: string, version: number, kind: "definition" | "data") => listeners.forEach((l) => l({ appId, version, kind }));

/* One change at a time per app: each change reads the current version and
   saves the next, so two at once must not both build on the same version. */
const locks = new Map<string, Promise<unknown>>();
function serialized<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(appId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => {});
  locks.set(appId, settled);
  settled.then(() => { if (locks.get(appId) === settled) locks.delete(appId); });
  return next;
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/* A new app starts as a valid, renderable shell: one Home screen that says
   what to do next. */
export function starterDefinition({ id, name, description = "", useCase = "", theme = "plain" }: { id: string; name: string; description?: string; useCase?: string; theme?: string }) {
  let doc = createApp({ id, name, description, useCase, module: "app", theme, roles: [{ id: "member", name: "Member" }] }) as AppDefinition;
  doc = putScreen(doc, {
    id: "home",
    title: name,
    pattern: "home",
    regions: [{ id: "start", kind: "notice", tone: "info", title: "This app is empty", message: "Describe what it is for in the studio's chat, and the assistant will design its data, screens and actions here." }],
  }) as AppDefinition;
  doc = setNavigation(doc, { navigation: [{ id: "home", label: "Home", screen: "home", icon: "home" }] }) as AppDefinition;
  return doc;
}

export function listApps() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "definition.json")))
    .map((d) => {
      const doc = read<AppDefinition>(join(ROOT, d.name, "definition.json"));
      const history = read<VersionMeta[]>(join(ROOT, d.name, "history.json"));
      const app = doc.extensions?.["umf.app"] ?? {};
      return { id: doc.id, name: app.name, description: app.description, useCase: app.useCase, version: app.version, revision: history.at(-1)?.version ?? 0, updatedAt: history.at(-1)?.at, variantOf: app.variantOf ?? null, visibility: app.visibility, theme: doc.extensions?.["umf.ux"]?.look?.theme, brandKit: doc.extensions?.["umf.ux"]?.look?.brandKit ?? null };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getApp(id: string): Promise<AppRecord> {
  const dir = dirOf(id);
  if (!existsSync(join(dir, "definition.json"))) throw new AppError(404, "APP_NOT_FOUND", `There is no app ${id}`);
  const definition = read<AppDefinition>(join(dir, "definition.json"));
  const history = read<VersionMeta[]>(join(dir, "history.json"));
  return { definition, verdict: await validateDefinition(definition), version: history.at(-1)?.version ?? 0, history };
}

async function save(doc: AppDefinition, meta: Omit<VersionMeta, "version" | "at">, { previous }: { previous?: AppDefinition } = {}) {
  const verdict = await validateDefinition(doc);
  if (!verdict.valid) throw new AppError(422, "DEFINITION_INVALID", `The change would make the app invalid (${verdict.errors.length} problem${verdict.errors.length === 1 ? "" : "s"}); nothing was saved`, { errors: verdict.errors, warnings: verdict.warnings });
  const dir = dirOf(doc.id);
  const history: VersionMeta[] = existsSync(join(dir, "history.json")) ? read(join(dir, "history.json")) : [];
  const version = (history.at(-1)?.version ?? 0) + 1;
  const entry: VersionMeta = { version, at: new Date().toISOString(), ...meta };
  const dataChanged = !previous || dataHash(previous) !== dataHash(doc) || !(await schemaExists(doc.id));
  if (dataChanged) await deployApp(doc);
  write(join(dir, "versions", `${String(version).padStart(4, "0")}.json`), doc);
  write(join(dir, "definition.json"), doc);
  write(join(dir, "history.json"), [...history, entry]);
  emitChange(doc.id, version, "definition");
  return { definition: doc, verdict, version, history: [...history, entry], redeployed: dataChanged };
}

/* A new app's look can be decided before it is built: a theme, or a brand kit from the library (on its design system), and a default appearance. */
export type StartingLook = { theme?: string; brandKit?: string; designSystem?: string; appearance?: "system" | "light" | "dark" };

export async function createAppRecord({ id, name, description, useCase, theme, brandKit, designSystem, appearance, definition, by = "person", operations = [], kind }: { id?: string; name: string; description?: string; useCase?: string; definition?: AppDefinition; by?: string; operations?: Operation[]; kind?: "own-data" } & StartingLook) {
  const appId = definition?.id ?? id ?? `app.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  if (existsSync(join(dirOf(appId), "definition.json"))) throw new AppError(409, "APP_EXISTS", `An app ${appId} already exists`);
  let doc = definition ?? starterDefinition({ id: appId, name, description, useCase, theme });
  if (!definition && (brandKit || appearance)) doc = setLook(doc, { ...(brandKit ? { brandKit, designSystem } : {}), ...(appearance ? { appearance } : {}) }) as AppDefinition;
  if (!definition && kind) doc = apply(doc, "setIdentity", { kind }) as AppDefinition;
  // A first version made from what was chosen at the start (an app on catalog data), applied like any other change.
  for (const [i, o] of operations.entries()) {
    try {
      doc = apply(doc, o.op, o.args ?? {}) as AppDefinition;
    } catch (e: any) {
      if (e instanceof OpError) throw new AppError(422, e.code, `The first version could not be made (step ${i + 1}, ${o.op}): ${e.message}`);
      throw e;
    }
  }
  checkLook(doc);
  return save(doc, { by, summary: definition ? `Imported ${name}` : operations.length ? `Created ${name} from the data catalog` : `Created ${name}`, operations });
}

/* Apply operations in order to the current definition; save once, if the
   result is valid. Returns the new record, or throws AppError with the first
   operation that could not be applied or the validation problems. */
export function applyOperations(id: string, operations: Operation[], options: { by?: string; summary?: string } = {}) {
  return serialized(id, () => applyOperationsNow(id, operations, options));
}

async function applyOperationsNow(id: string, operations: Operation[], { by = "person", summary }: { by?: string; summary?: string } = {}) {
  if (!Array.isArray(operations) || operations.length === 0) throw new AppError(400, "NO_OPERATIONS", "Give at least one operation");
  const current = await getApp(id);
  let doc = current.definition;
  for (const [i, o] of operations.entries()) {
    const check = argValidators[o.op];
    if (!check) throw new AppError(422, "OP_UNKNOWN", `Operation ${i + 1}: there is no operation ${o.op}; nothing was saved`, { index: i });
    if (!check(o.args ?? {})) throw new AppError(422, "OP_ARGS", `Operation ${i + 1} (${o.op}) has invalid arguments: ${ajv.errorsText(check.errors)}; nothing was saved`, { index: i, errors: check.errors });
    try {
      doc = apply(doc, o.op, o.args ?? {}) as AppDefinition;
    } catch (e: any) {
      if (e instanceof OpError) throw new AppError(422, e.code, `Operation ${i + 1} (${o.op}) could not be applied: ${e.message}; nothing was saved`, { index: i });
      throw e;
    }
  }
  if (doc.id !== id) throw new AppError(422, "APP_ID_CHANGED", "Operations may not change an app's id; create a variant instead");
  checkLook(doc, current.definition);
  return save(doc, { by, summary: summary ?? operations.map((o) => o.op).join(", "), operations }, { previous: current.definition });
}

export async function createVariant(id: string, { newId, name, note, by = "person" }: { newId?: string; name?: string; note?: string; by?: string }) {
  const base = await getApp(id);
  const variantId = newId ?? `${id}-variant-${Date.now().toString(36)}`;
  if (existsSync(join(dirOf(variantId), "definition.json"))) throw new AppError(409, "APP_EXISTS", `An app ${variantId} already exists`);
  const doc = makeVariant(base.definition, { id: variantId, name, note }) as AppDefinition;
  return save(doc, { by, summary: `Variant of ${base.definition.extensions["umf.app"].name}${note ? `: ${note}` : ""}`, operations: [] });
}

export async function getVersion(id: string, version: number) {
  const file = join(dirOf(id), "versions", `${String(version).padStart(4, "0")}.json`);
  if (!existsSync(file)) throw new AppError(404, "VERSION_NOT_FOUND", `App ${id} has no version ${version}`);
  return read<AppDefinition>(file);
}

export function restoreVersion(id: string, version: number, by = "person") {
  return serialized(id, () => restoreVersionNow(id, version, by));
}

async function restoreVersionNow(id: string, version: number, by = "person") {
  const current = await getApp(id);
  const doc = await getVersion(id, version);
  return save(doc, { by, summary: `Restored version ${version}`, operations: [] }, { previous: current.definition });
}

export async function resetData(id: string) {
  const { definition, version } = await getApp(id);
  await deployApp(definition);
  emitChange(id, version, "data");
}

export const describe = (doc: AppDefinition) => summarize(doc);
