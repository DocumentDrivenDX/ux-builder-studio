/* The local identity provider: a real OpenID Connect provider
   (oidc-provider), so the studio's sign-in is the same code path as with the
   organisation's own (Entra ID, Okta, Google, or a Databricks workspace).
   Its people and groups are the sample organisation's. Signing in here is
   choosing one of them; there are no passwords, because nothing here is
   real.

   It issues two tokens per sign-in: an ID token for the studio (who the
   person is, with their groups), and an access token for the data catalog
   (a JWT for the catalog's audience), which the studio passes on so the
   catalog answers as that person. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import express from "express";
import Provider, { type Configuration } from "oidc-provider";
import { exportJWK, generateKeyPair } from "jose";
import { CATALOG_AUDIENCE } from "./catalog-server.js";
import { GROUPS, ORG, PEOPLE, personById } from "./sample-org.js";

export type LocalIdp = { issuer: string; clientId: string; clientSecret: string; close(): Promise<void> };

async function keys(file: string | null) {
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const value = { jwk: { ...(await exportJWK(privateKey)), kid: `local-${Date.now().toString(36)}`, alg: "RS256", use: "sig" }, cookie: randomBytes(32).toString("hex"), clientSecret: randomBytes(24).toString("hex") };
  if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); }
  return value;
}

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function chooserPage(uid: string, clientName: string) {
  const groupName = (g: string) => GROUPS.find((x) => x.id === g)?.name ?? g;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to ${esc(ORG.short)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2129;--muted:#5b6270;--line:#d9dde4;--accent:#2457c5;--accent-text:#fff;--focus:#2457c5}
@media (prefers-color-scheme: dark){:root{--bg:#14161a;--card:#1d2026;--text:#eceef2;--muted:#a6adba;--line:#353a44;--accent:#7aa2ff;--accent-text:#0b1020;--focus:#9ab8ff}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;max-width:560px;width:100%}
h1{font-size:1.4rem;margin:0 0 4px}p{margin:0 0 16px;color:var(--muted)}
fieldset{border:0;padding:0;margin:0 0 20px;display:grid;gap:8px}legend{font-weight:600;margin-bottom:8px}
label{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start;border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer}
label:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
input{margin-top:4px;accent-color:var(--accent)}input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.who{font-weight:600}.what{grid-column:2;color:var(--muted);font-size:.9rem}
button{font:inherit;font-weight:600;background:var(--accent);color:var(--accent-text);border:0;border-radius:8px;padding:10px 18px;cursor:pointer}
button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.note{font-size:.85rem;margin-top:16px}
</style></head><body><main>
<h1>Sign in to ${esc(ORG.name)}</h1>
<p>${esc(clientName)} wants to know who you are. This is the sample organisation's own sign-in, running on this computer: choose who to be.</p>
<form method="post" action="/interaction/${esc(uid)}/login">
<fieldset><legend>Sign in as</legend>
${PEOPLE.map((p, i) => `<label><input type="radio" name="person" value="${esc(p.id)}"${i === 0 ? " checked" : ""}><span class="who">${esc(p.name)}, ${esc(p.title)}</span><span class="what">${esc(p.groups.map(groupName).join(", "))}. ${esc(p.about)}.</span></label>`).join("\n")}
</fieldset>
<button type="submit">Sign in</button>
</form>
<p class="note">Everyone here is made up. With the organisation's own identity provider, people sign in with their work account instead.</p>
</main></body></html>`;
}

export async function startLocalIdp({ port, dataDir, redirectUris, postLogoutUris }: { port: number; dataDir: string | null; redirectUris: string[]; postLogoutUris: string[] }): Promise<LocalIdp> {
  const issuer = `http://127.0.0.1:${port}`;
  const k = await keys(dataDir ? join(dataDir, "idp-keys.json") : null);
  const clientId = "ux-builder-studio";
  const config: Configuration = {
    clients: [{ client_id: clientId, client_secret: k.clientSecret, client_name: "UX Builder Studio", redirect_uris: redirectUris, post_logout_redirect_uris: postLogoutUris, grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "client_secret_basic" }],
    jwks: { keys: [k.jwk] },
    cookies: { keys: [k.cookie] },
    pkce: { required: () => true },
    scopes: ["openid", "profile", "email", "groups", "catalog"],
    claims: { openid: ["sub"], profile: ["name"], email: ["email", "email_verified"], groups: ["groups"] },
    conformIdTokenClaims: false,
    findAccount: async (_ctx, sub) => {
      const p = personById(sub);
      if (!p) return undefined;
      return { accountId: p.id, claims: async () => ({ sub: p.id, name: p.name, email: p.email, email_verified: true, groups: p.groups }) };
    },
    extraTokenClaims: async (_ctx, token) => {
      const p = personById((token as { accountId?: string }).accountId ?? "");
      return p ? { email: p.email, groups: p.groups } : undefined;
    },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => CATALOG_AUDIENCE,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (resource !== CATALOG_AUDIENCE) throw new Error(`Unknown resource ${resource}`);
          return { scope: "catalog", audience: CATALOG_AUDIENCE, accessTokenFormat: "jwt", accessTokenTTL: 8 * 3600, jwt: { sign: { alg: "RS256" } } };
        },
      },
    },
    // The studio is the organisation's own app: no consent screen.
    loadExistingGrant: async (ctx) => {
      const grantId = ctx.oidc.result?.consent?.grantId ?? ctx.oidc.session!.grantIdFor(ctx.oidc.client!.clientId);
      if (grantId) {
        const existing = await ctx.oidc.provider.Grant.find(grantId);
        if (existing) return existing;
      }
      const grant = new ctx.oidc.provider.Grant({ clientId: ctx.oidc.client!.clientId, accountId: ctx.oidc.session!.accountId! });
      grant.addOIDCScope("openid profile email groups catalog");
      grant.addOIDCClaims(["name", "email", "email_verified", "groups"]);
      grant.addResourceScope(CATALOG_AUDIENCE, "catalog");
      await grant.save();
      return grant;
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    ttl: { AccessToken: 8 * 3600, AuthorizationCode: 120, IdToken: 8 * 3600, Interaction: 900, Session: 8 * 3600, Grant: 8 * 3600 },
    renderError: async (ctx, out) => {
      ctx.type = "html";
      ctx.body = `<!doctype html><title>Sign-in problem</title><body style="font-family:system-ui;padding:24px"><h1>Sign-in problem</h1><p>${esc(String(out.error_description ?? out.error))}</p><p><a href="javascript:history.back()">Go back</a></p></body>`;
    },
  };
  const provider = new Provider(issuer, config);
  const app = express();
  app.disable("x-powered-by");
  app.get("/interaction/:uid", async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name !== "login") return provider.interactionFinished(req, res, {}, { mergeWithLastSubmission: true });
      res.type("html").set("cache-control", "no-store").send(chooserPage(details.uid, "UX Builder Studio"));
    } catch (e) { next(e); }
  });
  app.post("/interaction/:uid/login", express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      const person = personById(String(req.body?.person ?? ""));
      if (!person) return res.redirect(303, `/interaction/${encodeURIComponent(String(req.params.uid))}`);
      await provider.interactionFinished(req, res, { login: { accountId: person.id } }, { mergeWithLastSubmission: false });
    } catch (e) { next(e); }
  });
  app.use(provider.callback());
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(port, "127.0.0.1", () => resolve(s)); });
  return { issuer, clientId, clientSecret: k.clientSecret, close: async () => { server.close(); } };
}
