#!/usr/bin/env node
/* Install UMF's SDK (@umf/core) for the studio server. UMF publishes its SDK as
   a platform-specific GitHub release asset, not on npm, so this downloads the
   asset for this machine, checks it against the release's SHA256SUMS, and
   installs it into apps/studio/.umf (gitignored) with its own dependencies.
   Run once: `npm run setup --workspace @ux-builder/studio`. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UMF_VERSION = process.env.UMF_VERSION ?? "0.10.10";
const TAG = `umf-v${UMF_VERSION}`;
const BASE = `https://github.com/DocumentDrivenDX/umf/releases/download/${TAG}`;
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", ".umf");

const platform = { darwin: "macos", linux: "linux" }[process.platform];
const arch = { arm64: "aarch64", x64: "x86_64" }[process.arch];
if (!platform || !arch) throw new Error(`UMF ${UMF_VERSION} has no SDK build for ${process.platform}/${process.arch}`);
const asset = `umf-sdk-${UMF_VERSION}-${platform}-${arch}.tgz`;

const marker = join(dir, "installed.json");
if (existsSync(marker) && JSON.parse(readFileSync(marker, "utf8")).asset === asset) {
  console.log(`UMF SDK ${UMF_VERSION} is already installed in ${dir}`);
  process.exit(0);
}

async function get(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

mkdirSync(dir, { recursive: true });
console.log(`Downloading ${asset} from ${BASE}`);
const [tgz, sums] = await Promise.all([get(`${BASE}/${asset}`), get(`${BASE}/SHA256SUMS`)]);
const expected = sums.toString("utf8").split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name?.replace(/^\*/, "") === asset)?.[0];
const actual = createHash("sha256").update(tgz).digest("hex");
if (!expected) throw new Error(`${asset} is not listed in the release's SHA256SUMS`);
if (expected !== actual) throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
const file = join(dir, asset);
writeFileSync(file, tgz);
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "studio-umf-sdk", private: true, type: "module" }, null, 2));
console.log(`Checksum OK (${actual.slice(0, 12)}…). Installing…`);
execFileSync("npm", ["install", "--no-audit", "--no-fund", "--no-save", `./${asset}`], { cwd: dir, stdio: "inherit" });
writeFileSync(marker, JSON.stringify({ version: UMF_VERSION, asset, sha256: actual }, null, 2));
console.log(`UMF SDK ${UMF_VERSION} installed in ${dir}`);
