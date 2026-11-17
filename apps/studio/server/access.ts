/* Who may do what with an app in the studio: separate from the app's
   definition (its design) and from its data (which the catalog governs).

   - The owner (who created it) may change it and share it.
   - Editors may change it; users may open and use it.
   - Editors and users are people ("user:<email>"), groups ("group:<id>") or
     everyone in the organisation ("everyone").
   - Changing any app needs a builder (a member of the builder groups).

   Apps made before sign-in existed have no owner: every builder may change
   them, and everyone may use them. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { User } from "./auth.js";

export type Principal = string;
export type AppAccess = { owner: string | null; editors: Principal[]; users: Principal[] };

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = () => join(process.env.STUDIO_DATA_DIR ?? join(here, "..", ".data"), "apps");
const fileOf = (appId: string) => join(ROOT(), appId.replace(/[^a-z0-9.-]/gi, "_"), "access.json");
const LEGACY: AppAccess = { owner: null, editors: ["everyone"], users: ["everyone"] };

export function readAccess(appId: string): AppAccess {
  const f = fileOf(appId);
  if (!existsSync(f)) return LEGACY;
  try { return { ...LEGACY, ...JSON.parse(readFileSync(f, "utf8")) }; } catch { return LEGACY; }
}

export function writeAccess(appId: string, access: AppAccess) {
  writeFileSync(fileOf(appId), JSON.stringify(access, null, 2));
}

const PRINCIPAL = /^(everyone|user:[^\s]+|group:[A-Za-z0-9_.-]+)$/;
export const validPrincipal = (p: string) => PRINCIPAL.test(p);

const matches = (user: User, p: Principal) =>
  p === "everyone" || (p.startsWith("user:") && p.slice(5).toLowerCase() === user.email.toLowerCase()) || (p.startsWith("group:") && user.groups.includes(p.slice(6)));

export const isOwner = (user: User, a: AppAccess) => !!a.owner && a.owner.toLowerCase() === user.email.toLowerCase();
export const canEdit = (user: User, a: AppAccess) => user.builder && (isOwner(user, a) || a.editors.some((p) => matches(user, p)));
export const canUse = (user: User, a: AppAccess) => isOwner(user, a) || canEdit(user, a) || a.users.some((p) => matches(user, p));
export const canShare = (user: User, a: AppAccess) => isOwner(user, a) || (!a.owner && user.builder);
