/* Who signs in, and which data catalog the studio reads, from the
   environment: by default, the sample organisation on this machine (its
   identity provider and its Unity Catalog stand-in), so the whole studio
   can be tried without anything outside. */

import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Auth, publicUrl, type AuthConfig } from "./auth.js";
import { setCatalog } from "./catalog/service.js";
import { UnityCatalog } from "./catalog/unity.js";
import { CATALOG_AUDIENCE, startCatalogServer } from "./org/catalog-server.js";
import { startLocalIdp } from "./org/idp.js";
import { ORG } from "./org/sample-org.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function startOrganisation() {
  const mode = (process.env.STUDIO_AUTH ?? "local") as AuthConfig["mode"];
  const dataDir = join(process.env.STUDIO_DATA_DIR ?? join(here, "..", ".data"), "org");
  const closers: Array<() => Promise<void>> = [];
  const builderGroups = (process.env.STUDIO_BUILDER_GROUPS ?? "studio-builders").split(",").map((s) => s.trim()).filter(Boolean);
  let auth: Auth;
  let catalogMode = process.env.STUDIO_CATALOG ?? (mode === "local" ? "local" : "none");

  if (mode === "local") {
    const idpPort = Number(process.env.STUDIO_IDP_PORT ?? 8790);
    const pub = publicUrl();
    const alt = pub.replace("//localhost", "//127.0.0.1");
    const idp = await startLocalIdp({ port: idpPort, dataDir, redirectUris: [...new Set([`${pub}/api/auth/callback`, `${alt}/api/auth/callback`])], postLogoutUris: [...new Set([pub, alt])] });
    closers.push(idp.close);
    auth = new Auth({ mode, issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, groupsClaim: "groups", builderGroups, publicUrl: pub, resource: CATALOG_AUDIENCE, label: `${ORG.name} (sample organisation, on this computer)` });
    if (catalogMode === "local") {
      const port = Number(process.env.STUDIO_CATALOG_PORT ?? 8791);
      const cat = await startCatalogServer({ port, issuer: idp.issuer, dataDir });
      closers.push(cat.close);
      setCatalog(new UnityCatalog({ host: cat.url, warehouseId: "local", label: `${ORG.name} data catalog (sample, on this computer)`, local: true }));
    }
  } else if (mode === "oidc") {
    const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`STUDIO_AUTH=oidc needs ${k}`); return v; };
    auth = new Auth({ mode, issuer: need("OIDC_ISSUER"), clientId: need("OIDC_CLIENT_ID"), clientSecret: process.env.OIDC_CLIENT_SECRET ?? null, groupsClaim: process.env.OIDC_GROUPS_CLAIM ?? "groups", builderGroups, publicUrl: publicUrl(), resource: process.env.OIDC_RESOURCE ?? null, label: process.env.OIDC_LABEL ?? new URL(need("OIDC_ISSUER")).host });
  } else {
    auth = new Auth({ mode: "none", issuer: null, clientId: null, clientSecret: null, groupsClaim: "groups", builderGroups, publicUrl: publicUrl(), resource: null, label: "No sign-in" });
    if (catalogMode === "local") catalogMode = "none";
  }

  if (catalogMode === "unity") {
    const host = process.env.DATABRICKS_HOST;
    const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
    if (!host || !warehouseId) throw new Error("STUDIO_CATALOG=unity needs DATABRICKS_HOST and DATABRICKS_WAREHOUSE_ID");
    setCatalog(new UnityCatalog({ host: host.replace(/\/$/, ""), warehouseId, label: `Unity Catalog at ${new URL(host).host}`, local: false }));
  } else if (catalogMode === "none") {
    setCatalog(null);
  }
  return { auth, close: async () => { for (const c of closers.reverse()) await c().catch(() => {}); } };
}
