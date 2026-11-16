#!/usr/bin/env node
/* Everything the studio needs before its first run, after `npm ci`:

   1. ux-builder (vendor/ux-builder, a submodule pinned to a commit) gets the
      studio's changes that are not upstream yet: each file in patches/ is
      applied once (a patch already applied is skipped).
   2. ux-builder's tokens and widgets are built (the studio uses their dist/).
   3. UMF's SDK is fetched from its GitHub release (checksum-verified).
   4. Playwright's Chromium is installed: the studio reads a website's brand
      with it, and the user test drives the studio with it.

   Safe to run again: it only does what is missing, except the builds, which
   are quick. */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor", "ux-builder");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const quiet = (cmd, args, cwd) => {
  try { execFileSync(cmd, args, { cwd, stdio: "ignore" }); return true; } catch { return false; }
};

if (!existsSync(join(vendor, "package.json"))) {
  console.log("Fetching ux-builder (submodule)…");
  run("git", ["submodule", "update", "--init", "--recursive"]);
}

const patches = join(root, "patches");
for (const file of readdirSync(patches).filter((f) => f.endsWith(".patch")).sort()) {
  const patch = join(patches, file);
  if (quiet("git", ["apply", "--reverse", "--check", patch], vendor)) { console.log(`ux-builder: ${file} already applied`); continue; }
  if (!quiet("git", ["apply", "--check", patch], vendor)) throw new Error(`ux-builder: ${file} does not apply to vendor/ux-builder at its pinned commit. Update or remove the patch.`);
  run("git", ["apply", patch], vendor);
  console.log(`ux-builder: applied ${file}`);
}

console.log("Building ux-builder's tokens and widgets…");
run("npm", ["run", "build", "--workspace", "@ux-builder/tokens"]);
run("npm", ["run", "build", "--workspace", "@ux-builder/ui"]);

run("npm", ["run", "setup", "--workspace", "@ux-builder/studio"]);

// The browser the studio reads websites with (brand from a URL) and its user test drives.
console.log("Installing the studio's browser (Chromium, for brand capture)…");
run("npx", ["playwright", "install", "chromium"]);
console.log("Ready: npm run dev");
