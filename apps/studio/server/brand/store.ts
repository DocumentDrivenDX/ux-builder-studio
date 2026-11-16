/* Brand captures and the brand kit library, as files under
   apps/studio/.data/brand/ (STUDIO_DATA_DIR/brand).

   A capture is one reading of a website: its screenshot, its logo, what was
   found, and the options made from it. A brand kit is the option a person
   chose, named and kept: a library shared by every app in the studio, so a
   firm's brand is captured once and used across its apps. An app refers to
   a kit by id (umf.ux look.brandKit); the kit's tokens are composed when the
   app is shown. */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrandAnalysis } from "./analyse.js";
import type { Finding } from "./checks.js";
import type { BrandDoc } from "./tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = () => join(process.env.STUDIO_DATA_DIR ?? join(here, "..", "..", ".data"), "brand");
const ID = /^[a-z0-9-]{1,80}$/;

export type CaptureRecord = {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  siteName: string | null;
  capturedAt: string;
  hasLogo: boolean;
  analysis: BrandAnalysis;
};

export type BrandKit = {
  id: string;
  name: string;
  createdAt: string;
  source: { url: string; title: string; captureId: string } | null;
  designSystem: string;
  option: { id: string; title: string; description: string; strategy: string };
  brand: BrandDoc & { generation?: unknown };
  colours: Array<{ hex: string; sources: string[] }>;
  findings: Finding[];
};

const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
  renameSync(tmp, file);
};
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8"));
const safe = (id: string) => { if (!ID.test(id)) throw new Error(`Invalid id ${id}`); return id; };

export const captureDir = (id: string) => join(root(), "captures", safe(id));
export const newId = () => randomUUID().slice(0, 8);

export function saveCapture(rec: CaptureRecord, files: { screenshot: Buffer; logo: Buffer | null }) {
  const dir = captureDir(rec.id);
  write(join(dir, "screenshot.png"), files.screenshot);
  if (files.logo) write(join(dir, "logo.png"), files.logo);
  write(join(dir, "capture.json"), rec);
}
export function getCapture(id: string): CaptureRecord | null {
  if (!ID.test(id)) return null;
  const file = join(captureDir(id), "capture.json");
  return existsSync(file) ? read<CaptureRecord>(file) : null;
}
export function captureFile(id: string, name: "screenshot.png" | "logo.png") {
  if (!ID.test(id)) return null;
  const file = join(captureDir(id), name);
  return existsSync(file) ? file : null;
}

const kitsDir = () => join(root(), "kits");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "brand";

export function listKits(): BrandKit[] {
  if (!existsSync(kitsDir())) return [];
  return readdirSync(kitsDir()).filter((f) => f.endsWith(".json")).map((f) => read<BrandKit>(join(kitsDir(), f)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getKit(id: string): BrandKit | null {
  if (!ID.test(id)) return null;
  const file = join(kitsDir(), `${id}.json`);
  return existsSync(file) ? read<BrandKit>(file) : null;
}
export const kitExists = (id: string) => getKit(id) !== null;

export function saveKit(kit: Omit<BrandKit, "id" | "createdAt">): BrandKit {
  let id = slug(kit.name);
  for (let n = 2; getKit(id); n++) id = `${slug(kit.name)}-${n}`;
  const full: BrandKit = { id, createdAt: new Date().toISOString(), ...kit };
  write(join(kitsDir(), `${id}.json`), full);
  return full;
}
export function removeKit(id: string) {
  if (!getKit(id)) return false;
  rmSync(join(kitsDir(), `${safe(id)}.json`));
  return true;
}
