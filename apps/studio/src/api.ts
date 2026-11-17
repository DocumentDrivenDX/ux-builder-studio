/* The studio API, from the browser. */
import type { ActionResult, AppDefinition, DataClient, Identity, Snapshot } from "@ux-builder/app-runtime/contract";

export type Diagnostic = { code: string; path: string; message: string; severity: "error" | "warning" };
export type Verdict = { valid: boolean; renderable: boolean; errors: Diagnostic[]; warnings: Diagnostic[] };
export type VersionMeta = { version: number; at: string; by: string; summary: string; operations: Array<{ op: string }> };
export type AppRights = { owner: string | null; edit: boolean; share: boolean; mine: boolean };
export type AppView = { definition: AppDefinition; summary: any; verdict: Verdict; version: number; history: VersionMeta[]; access?: AppRights };
export type CatalogEntry = { id: string; name: string; description?: string; useCase?: string; version: string; revision: number; updatedAt?: string; variantOf: { id: string; version: string } | null; theme?: string; brandKit?: string | null; access?: AppRights };
export type AppKind = "reporting" | "data-management" | "own-data";
export type AppAccess = { owner: string | null; editors: string[]; users: string[] };

/* The organisation's data catalog, as the signed-in person sees it. */
export type TableAccess = { read: boolean; change: boolean; readVia: string | null; changeVia: string | null };
export type CatalogInfo = { available: boolean; label: string; local: boolean; host: string | null };
export type CatalogTree = Array<{ name: string; comment: string | null; schemas: Array<{ name: string; fullName: string; comment: string | null; tables: Array<{ name: string; fullName: string; comment: string | null; access: TableAccess }> }> }>;
export type CatalogColumn = { name: string; type: string; typeName: string; comment: string | null; nullable: boolean; mask: { function: string; comment: string | null } | null; values: string[] | null };
export type CatalogTable = {
  fullName: string; catalog: string; schema: string; name: string; comment: string | null; owner: string | null;
  columns: CatalogColumn[]; primaryKey: string | null; foreignKeys: Array<{ column: string; parent: string; parentColumn: string }>;
  rowFilter: { function: string; columns: string[]; comment: string | null } | null; access: TableAccess;
};
export type ApiError = { ok: false; code: string; message: string; details?: any };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ ok: false, code: "BAD_RESPONSE", message: `${res.status} ${res.statusText}` }));
  if (res.status === 401 && data?.code === "SIGNED_OUT" && typeof window !== "undefined") window.dispatchEvent(new Event("studio:signed-out"));
  if (!res.ok) throw Object.assign(new Error(data.message ?? res.statusText), { status: res.status, body: data as ApiError });
  return data as T;
}

export const api = {
  health: () => call<{ ok: boolean; umf: string; database: string; agent: boolean }>("GET", "/api/health"),
  themes: () => call<{ themes: Array<{ name: string; title: string; designSystem: string; default: string }> }>("GET", "/api/themes"),
  apps: () => call<{ apps: CatalogEntry[] }>("GET", "/api/apps"),
  createApp: (input: { name: string; useCase?: string; description?: string; theme?: string; brandKit?: string; designSystem?: string; appearance?: string; by?: string; kind?: AppKind; sources?: Array<{ asset: string; access?: "read" | "change" }> }) => call<AppView>("POST", "/api/apps", input),
  access: (id: string) => call<{ access: AppAccess; rights: AppRights }>("GET", `/api/apps/${encodeURIComponent(id)}/access`),
  share: (id: string, input: { editors: string[]; users: string[] }) => call<{ access: AppAccess; rights: AppRights }>("PUT", `/api/apps/${encodeURIComponent(id)}/access`, input),
  directory: () => call<{ groups: Array<{ id: string; name: string; description: string }>; people: Array<{ email: string; name: string; title: string }> }>("GET", "/api/directory"),
  catalog: () => call<CatalogInfo>("GET", "/api/catalog"),
  catalogTree: () => call<{ catalog: CatalogInfo; tree: CatalogTree }>("GET", "/api/catalog/tree"),
  catalogTable: (fullName: string) => call<CatalogTable>("GET", `/api/catalog/tables/${encodeURIComponent(fullName)}`),
  catalogRows: (fullName: string, limit = 20) => call<{ columns: string[]; rows: Array<Record<string, string | null>> }>("GET", `/api/catalog/tables/${encodeURIComponent(fullName)}/rows?limit=${limit}`),
  app: (id: string) => call<AppView>("GET", `/api/apps/${encodeURIComponent(id)}`),
  apply: (id: string, operations: Array<{ op: string; args?: unknown }>, summary?: string, by = "person") => call<AppView & { redeployed: boolean }>("POST", `/api/apps/${encodeURIComponent(id)}/operations`, { operations, summary, by }),
  variant: (id: string, input: { name: string; note?: string; by?: string }) => call<AppView>("POST", `/api/apps/${encodeURIComponent(id)}/variants`, input),
  restore: (id: string, version: number, by = "person") => call<AppView>("POST", `/api/apps/${encodeURIComponent(id)}/versions/${version}/restore`, { by }),
  reset: (id: string) => call<{ ok: boolean }>("POST", `/api/apps/${encodeURIComponent(id)}/runtime/reset`, {}),
  deployment: (id: string) => call<{ schema: string; steps: Array<{ id: string; kind: string; sql: string }>; digest: string }>("GET", `/api/apps/${encodeURIComponent(id)}/deployment`),
  agentSession: () => call<{ realtimeUrl: string; token: string; model: string; description: string }>("GET", "/api/agent/session"),
  designSystems: () => call<{ designSystems: DesignSystemInfo[] }>("GET", "/api/brand/design-systems"),
  captureBrand: (url: string, designSystem?: string) => call<BrandCapture>("POST", "/api/brand/captures", { url, designSystem }),
  brandCapture: (id: string, designSystem?: string) => call<BrandCapture>("GET", `/api/brand/captures/${encodeURIComponent(id)}${designSystem ? `?designSystem=${encodeURIComponent(designSystem)}` : ""}`),
  brandFromLogo: (filename: string, data: string, designSystem?: string) => call<BrandCapture>("POST", "/api/brand/captures/logo", { filename, data, designSystem }),
  adjustBrandOption: (captureId: string, input: { optionId: string; designSystem: string; adjust: Record<string, number> }) => call<PaletteOption>("POST", `/api/brand/captures/${encodeURIComponent(captureId)}/adjust`, input),
  brandKits: () => call<{ kits: BrandKit[] }>("GET", "/api/brand/kits"),
  saveBrandKit: (input: { captureId: string; optionId: string; designSystem: string; name?: string; adjust?: Record<string, number> }) => call<BrandKit>("POST", "/api/brand/kits", input),
  removeBrandKit: (id: string) => call<{ ok: true }>("DELETE", `/api/brand/kits/${encodeURIComponent(id)}`),
  brandKitSources: (id: string) => call<KitSources>("GET", `/api/brand/kits/${encodeURIComponent(id)}/sources`),
  brandKitTokens: (id: string) => call<KitTokens>("GET", `/api/brand/kits/${encodeURIComponent(id)}/tokens`),
};

/* Brand: a website's brand, the palette options made from it, and kits. */
export type DesignSystemInfo = { name: string; title: string; summary: string };
export type KitTokens = { light: Record<string, string>; dark: Record<string, string> };
export type ColourFinding = { rule: string; title: string; appearance: "light" | "dark" | "both"; severity: "error" | "review"; message: string };
export type StyleInfo = DesignSystemInfo & { findings: ColourFinding[] };
export type AdjustRange = { name: string; label: string; min: number; max: number; default: number; step: number };
export type Swatches = Record<"structure" | "accent" | "ground" | "surface" | "text", string>;
export type PaletteOption = { id: string; title: string; description: string; strategy: string; tokens: KitTokens; swatches: Record<"light" | "dark", Swatches>; findings: ColourFinding[]; settings: Record<string, number>; adjusted?: Record<string, number> };
export type BrandCapture = {
  id: string; source: "website" | "logo"; url: string; finalUrl: string; title: string; name: string; capturedAt: string; screenshot: string | null; screenshotHeight?: number | null; logo: string | null;
  styles: StyleInfo[]; adjustable: AdjustRange[];
  analysis: {
    colours: Array<{ hex: string; share: number; sources: Array<{ kind: string; label: string }> }>;
    monochrome: boolean;
    page: { appearance: "light" | "dark"; background: string; text: string | null };
    fonts: { body: string; heading: string | null; loaded: string[] };
    style: { buttonRadius: number | null; pill: boolean; designSystem: string; reason: string };
  };
  designSystem: string; options: PaletteOption[]; notes: string[];
};
export type BrandKit = {
  id: string; name: string; createdAt: string; source: { url: string; title: string; captureId: string } | null; designSystem: string;
  option: { id: string; title: string; description: string; strategy: string; adjusted?: Record<string, number> };
  swatches: { structure?: string; accent?: string; ground?: string; surface?: string };
  colours: Array<{ hex: string; sources: string[] }>; findings: ColourFinding[]; usedBy: Array<{ id: string; name: string }>;
};
/* Where a kit came from (its capture, read-only) and what was chosen from it. */
export type KitSources = {
  kit: BrandKit;
  chosen: { option: { id: string; title: string; description: string; strategy: string }; designSystem: string; settings: Record<string, number> | null; adjusted: Record<string, number> | null; findings: ColourFinding[] };
  capture: null | {
    id: string; source: "website" | "logo"; url: string; finalUrl: string; title: string; name: string; capturedAt: string;
    screenshot: string | null; screenshotHeight: number | null; logo: string | null;
    colours: BrandCapture["analysis"]["colours"]; fonts: BrandCapture["analysis"]["fonts"]; style: BrandCapture["analysis"]["style"]; notes: string[];
  };
  missing: string | null;
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
