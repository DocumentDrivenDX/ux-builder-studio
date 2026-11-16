#!/usr/bin/env node
/* One command for the whole studio, locally: the server (UMF, Postgres, Redis,
   the agent) and the web UI. Reads apps/studio/.env when present. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = join(root, ".env");
if (!existsSync(join(root, ".umf", "installed.json"))) {
  console.error("UMF's SDK is not installed yet: run `npm run setup --workspace @ux-builder/studio` once.");
  process.exit(1);
}
const procs = [];
const run = (name, cmd, args) => {
  const p = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = (s) => s.toString().split("\n").filter(Boolean).map((l) => `[${name}] ${l}`).join("\n") + "\n";
  p.stdout.on("data", (d) => process.stdout.write(tag(d)));
  p.stderr.on("data", (d) => process.stderr.write(tag(d)));
  p.on("exit", (code) => { console.log(`[${name}] exited ${code}`); stop(); });
  procs.push(p);
};
const stop = () => { for (const p of procs) if (!p.killed) p.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
run("server", process.execPath, [...(existsSync(env) ? [`--env-file=${env}`] : []), "--import", "tsx", "server/main.ts"]);
// Start the web UI once the server answers, so an open tab never asks a server
// that is still loading UMF and the database (which shows as ECONNREFUSED).
const api = `http://127.0.0.1:${process.env.STUDIO_API_PORT ?? 8787}/api/health`;
console.log("Starting the studio server (UMF, database, agent)…");
const t0 = Date.now();
while (!(await fetch(api).then((r) => r.ok).catch(() => false))) {
  if (Date.now() - t0 > 5 * 60 * 1000) { console.error("The studio server did not start within 5 minutes; see the [server] lines above."); stop(); }
  await new Promise((r) => setTimeout(r, 1000));
}
run("web", process.execPath, [join(root, "..", "..", "node_modules", "vite", "bin", "vite.js")]);
console.log(`UX Builder Studio: http://localhost:${process.env.STUDIO_WEB_PORT ?? 5173} (server ready in ${Math.round((Date.now() - t0) / 1000)} s)`);
