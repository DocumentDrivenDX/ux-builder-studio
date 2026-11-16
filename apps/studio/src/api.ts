/* The studio API, from the browser. */
import type { ActionResult, AppDefinition, DataClient, Identity, Snapshot } from "@ux-builder/app-runtime/contract";

export type Diagnostic = { code: string; path: string; message: string; severity: "error" | "warning" };
export type Verdict = { valid: boolean; renderable: boolean; errors: Diagnostic[]; warnings: Diagnostic[] };
export type VersionMeta = { version: number; at: string; by: string; summary: string; operations: Array<{ op: string }> };
export type AppView = { definition: AppDefinition; summary: any; verdict: Verdict; version: number; history: VersionMeta[] };
export type CatalogEntry = { id: string; name: string; description?: string; useCase?: string; version: string; revision: number; updatedAt?: string; variantOf: { id: string; version: string } | null; theme?: string };
export type ApiError = { ok: false; code: string; message: string; details?: any };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ ok: false, code: "BAD_RESPONSE", message: `${res.status} ${res.statusText}` }));
  if (!res.ok) throw Object.assign(new Error(data.message ?? res.statusText), { status: res.status, body: data as ApiError });
  return data as T;
}

export const api = {
  health: () => call<{ ok: boolean; umf: string; database: string; agent: boolean }>("GET", "/api/health"),
  themes: () => call<{ themes: Array<{ name: string; title: string; designSystem: string; default: string }> }>("GET", "/api/themes"),
  apps: () => call<{ apps: CatalogEntry[] }>("GET", "/api/apps"),
  createApp: (input: { name: string; useCase?: string; description?: string; theme?: string; by?: string }) => call<AppView>("POST", "/api/apps", input),
  app: (id: string) => call<AppView>("GET", `/api/apps/${encodeURIComponent(id)}`),
  apply: (id: string, operations: Array<{ op: string; args?: unknown }>, summary?: string, by = "person") => call<AppView & { redeployed: boolean }>("POST", `/api/apps/${encodeURIComponent(id)}/operations`, { operations, summary, by }),
  variant: (id: string, input: { name: string; note?: string; by?: string }) => call<AppView>("POST", `/api/apps/${encodeURIComponent(id)}/variants`, input),
  restore: (id: string, version: number, by = "person") => call<AppView>("POST", `/api/apps/${encodeURIComponent(id)}/versions/${version}/restore`, { by }),
  reset: (id: string) => call<{ ok: boolean }>("POST", `/api/apps/${encodeURIComponent(id)}/runtime/reset`, {}),
  deployment: (id: string) => call<{ schema: string; steps: Array<{ id: string; kind: string; sql: string }>; digest: string }>("GET", `/api/apps/${encodeURIComponent(id)}/deployment`),
  agentSession: () => call<{ realtimeUrl: string; token: string; model: string; description: string }>("GET", "/api/agent/session"),
};

/* One EventSource for the whole tab: definition and data changes. */
type ChangeEvent = { appId: string; version: number; kind: "definition" | "data" };
const changeListeners = new Set<(e: ChangeEvent) => void>();
let source: EventSource | null = null;
export function onChange(listener: (e: ChangeEvent) => void) {
  if (!source && typeof EventSource !== "undefined") {
    source = new EventSource("/api/events");
    source.addEventListener("change", (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as ChangeEvent;
      changeListeners.forEach((l) => l(e));
    });
  }
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/* The preview's DataClient: the app's runtime on the studio server, as one person. */
export function httpClient(appId: string, identity: Identity): DataClient {
  const base = `/api/apps/${encodeURIComponent(appId)}/runtime`;
  return {
    identity,
    async snapshot(): Promise<Snapshot> {
      const s = await call<Snapshot & { identity: Identity }>("GET", `${base}/snapshot?as=${encodeURIComponent(identity.id)}`);
      return { records: s.records, now: s.now, revision: s.revision };
    },
    async run(action, params): Promise<ActionResult> {
      const res = await fetch(`${base}/actions/${encodeURIComponent(action)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ as: identity.id, params }) });
      return (await res.json()) as ActionResult;
    },
    subscribe(listener) {
      return onChange((e) => { if (e.appId === appId) listener(); });
    },
  };
}
