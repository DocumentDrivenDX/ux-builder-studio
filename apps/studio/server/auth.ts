/* Signing in to the studio, with OpenID Connect.

   STUDIO_AUTH chooses who people are:
   - local (the default): the sample organisation's identity provider, which
     runs on this machine (server/org/idp.ts);
   - oidc: the organisation's own provider (OIDC_ISSUER, OIDC_CLIENT_ID,
     OIDC_CLIENT_SECRET; OIDC_GROUPS_CLAIM names the claim holding a person's
     groups, "groups" by default). With a Databricks workspace as the issuer,
     the access token it returns also reads its Unity Catalog as the person;
   - none: no sign-in; one local owner, with no data catalog (for tests and
     for building apps on their own data only).

   A session is a random id in an HttpOnly cookie; what it stands for (the
   person, and their token for the data catalog) stays on the server, under
   the studio's data folder, so a restart doesn't sign everyone out. */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response, Express } from "express";
import * as oidc from "openid-client";

export type User = { id: string; name: string; email: string; groups: string[]; builder: boolean; solo?: boolean };
type Session = { id: string; user: User; catalogToken: string | null; expiresAt: number; createdAt: number };
type Pending = { verifier: string; returnTo: string; at: number };

export type AuthConfig = {
  mode: "local" | "oidc" | "none";
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  groupsClaim: string;
  builderGroups: string[];
  publicUrl: string;
  resource: string | null;
  label: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const DATA = () => process.env.STUDIO_DATA_DIR ?? join(here, "..", ".data");
const COOKIE = "studio_session";
const OWNER: User = { id: "owner", name: "Studio owner", email: "owner@localhost", groups: ["studio-builders"], builder: true, solo: true };

export function publicUrl() {
  return (process.env.STUDIO_PUBLIC_URL ?? `http://localhost:${process.env.STUDIO_WEB_PORT ?? 5173}`).replace(/\/$/, "");
}

export class Auth {
  private sessions = new Map<string, Session>();
  private pending = new Map<string, Pending>();
  private client: Promise<oidc.Configuration> | null = null;
  private file: string;

  constructor(public config: AuthConfig) {
    this.file = join(DATA(), "sessions.json");
    if (existsSync(this.file)) {
      try {
        for (const s of JSON.parse(readFileSync(this.file, "utf8")) as Session[]) if (s.expiresAt > Date.now()) this.sessions.set(s.id, s);
      } catch { /* a damaged file only means signing in again */ }
    }
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...this.sessions.values()]), { mode: 0o600 });
  }

  private discovery() {
    const c = this.config;
    return (this.client ??= oidc.discovery(new URL(c.issuer!), c.clientId!, c.clientSecret ?? undefined, undefined, c.issuer!.startsWith("http://") ? { execute: [oidc.allowInsecureRequests] } : undefined).catch((e) => {
      this.client = null;
      throw e;
    }));
  }

  /* The session a request carries, if it is still good. */
  session(req: Request): Session | null {
    if (this.config.mode === "none") return { id: "none", user: OWNER, catalogToken: null, expiresAt: Infinity, createdAt: 0 };
    const id = cookieOf(req, COOKIE);
    const s = id ? this.sessions.get(id) : undefined;
    if (!s) return null;
    if (s.expiresAt <= Date.now()) { this.sessions.delete(s.id); this.persist(); return null; }
    return s;
  }

  mount(app: Express) {
    app.get("/api/auth/login", (req, res, next) => this.login(req, res).catch(next));
    app.get("/api/auth/callback", (req, res, next) => this.callback(req, res).catch(next));
    app.post("/api/auth/logout", (req, res) => {
      const id = cookieOf(req, COOKIE);
      if (id && this.sessions.delete(id)) this.persist();
      res.set("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`).json({ ok: true });
    });
    /* On this machine (the sample organisation's sign-in), the studio can also be used on your own:
       every builder feature, with apps on their own data, and no organisation or data catalog. */
    app.post("/api/auth/solo", (_req, res) => {
      if (this.config.mode !== "local") return res.status(403).json({ ok: false, code: "SIGN_IN_REQUIRED", message: "This studio needs you to sign in with your organisation" });
      const id = randomBytes(24).toString("base64url");
      const ttl = 30 * 24 * 3600 * 1000;
      this.sessions.set(id, { id, user: OWNER, catalogToken: null, expiresAt: Date.now() + ttl, createdAt: Date.now() });
      this.persist();
      res.set("set-cookie", `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}`).json({ ok: true, user: OWNER });
    });
    app.get("/api/me", (req, res) => {
      const s = this.session(req);
      res.json({ user: s?.user ?? null, catalog: !!s?.catalogToken, auth: { mode: this.config.mode, label: this.config.label, solo: this.config.mode === "local" }, expiresAt: s && Number.isFinite(s.expiresAt) ? new Date(s.expiresAt).toISOString() : null });
    });
  }

  /* Everything under /api needs a signed-in person, except signing in and the health check. */
  guard() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (/^\/api\/(health|auth\/|me$)/.test(req.path)) return next();
      const s = this.session(req);
      if (!s) return res.status(401).json({ ok: false, code: "SIGNED_OUT", message: "Sign in to use the studio" });
      (req as Request & { studio?: Session }).studio = s;
      next();
    };
  }

  private async login(req: Request, res: Response) {
    if (this.config.mode === "none") return res.redirect(303, "/");
    const config = await this.discovery();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const raw = String(req.query.return ?? "/");
    const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
    this.pending.set(state, { verifier, returnTo, at: Date.now() });
    for (const [k, p] of this.pending) if (Date.now() - p.at > 15 * 60 * 1000) this.pending.delete(k);
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${publicUrl()}/api/auth/callback`,
      scope: `openid profile email ${this.config.mode === "local" ? "groups catalog" : process.env.OIDC_SCOPES ?? "groups"}`.trim(),
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      // Always ask who: switching between people is part of trying the studio.
      ...(this.config.mode === "local" ? { prompt: "login" } : {}),
      ...(this.config.resource ? { resource: this.config.resource } : {}),
    });
    res.redirect(303, url.href);
  }

  private async callback(req: Request, res: Response) {
    const config = await this.discovery();
    const state = String(req.query.state ?? "");
    const p = this.pending.get(state);
    if (!p) return res.redirect(303, "/?signin=expired");
    this.pending.delete(state);
    const current = new URL(req.originalUrl, publicUrl());
    const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: p.verifier, expectedState: state }, this.config.resource ? { resource: this.config.resource } : undefined);
    const claims = tokens.claims() ?? ({} as Record<string, unknown>);
    const groupsValue = claims[this.config.groupsClaim];
    const groups = (Array.isArray(groupsValue) ? groupsValue : typeof groupsValue === "string" ? groupsValue.split(/[ ,]+/) : []).map(String).filter(Boolean);
    const user: User = {
      id: String(claims.sub),
      name: String(claims.name ?? claims.preferred_username ?? claims.email ?? claims.sub),
      email: String(claims.email ?? claims.preferred_username ?? ""),
      groups,
      builder: this.config.builderGroups.includes("*") || groups.some((g) => this.config.builderGroups.includes(g)),
    };
    const id = randomBytes(24).toString("base64url");
    const ttl = Math.min(Number(tokens.expires_in ?? 8 * 3600), 12 * 3600) * 1000;
    this.sessions.set(id, { id, user, catalogToken: tokens.access_token ?? null, expiresAt: Date.now() + ttl, createdAt: Date.now() });
    this.persist();
    res.set("set-cookie", `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}`).redirect(303, p.returnTo);
  }
}

export const sessionOf = (req: Request) => (req as Request & { studio?: Session }).studio ?? null;
export const userOf = (req: Request): User => sessionOf(req)?.user ?? OWNER;

function cookieOf(req: Request, name: string) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
