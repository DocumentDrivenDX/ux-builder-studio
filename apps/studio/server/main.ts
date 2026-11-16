/* Start the studio server: Redis (spawned locally when nothing listens on its
   port), OUI's realtime server and agent worker, and the studio API. Every
   piece runs on this machine; the only outside call is to an AI model
   provider, and only when a key is configured. */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { loadUmf } from "./umf.js";
import { database, describeDatabase } from "./db.js";
import { createApi } from "./api.js";

const API_PORT = Number(process.env.STUDIO_API_PORT ?? 8787);
const WEB_ORIGINS = (process.env.STUDIO_WEB_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",");
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

const listening = (port: number, host = "127.0.0.1") =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ port, host });
    s.once("connect", () => { s.end(); resolve(true); });
    s.once("error", () => resolve(false));
  });

async function ensureRedis() {
  if (await listening(REDIS_PORT)) return "existing";
  const child = spawn("redis-server", ["--port", String(REDIS_PORT), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  child.unref();
  process.on("exit", () => child.kill());
  for (let i = 0; i < 50 && !(await listening(REDIS_PORT)); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await listening(REDIS_PORT))) throw new Error("Redis did not start; install it (brew install redis) or set REDIS_PORT to a running server");
  return "spawned";
}

const t0 = Date.now();
const { version } = await loadUmf();
await database();
let agent = null;
if (!process.env.STUDIO_NO_AGENT) {
  const redis = await ensureRedis();
  const { startAgent } = await import("./agent/index.js");
  agent = await startAgent({ webOrigins: WEB_ORIGINS, realtimePort: Number(process.env.STUDIO_REALTIME_PORT ?? 3331), workerPort: Number(process.env.STUDIO_WORKER_PORT ?? 8091) });
  console.log(`agent: ${agent.model} (redis ${redis} on ${REDIS_PORT})`);
}
const app = createApi({ agent });
const server = app.listen(API_PORT, "127.0.0.1", async () => {
  console.log(`studio api: http://127.0.0.1:${API_PORT} (UMF ${version}, ${await describeDatabase()}, ready in ${Date.now() - t0} ms)`);
});
const stop = async () => {
  server.close();
  await agent?.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
