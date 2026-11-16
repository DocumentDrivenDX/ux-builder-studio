/* UMF's SDK in its own thread. Loading it, validating with it and compiling
   tables with it are CPU-heavy and synchronous; here they never block the
   studio's API, OUI's realtime server or the agent worker. Messages:
     {id, op: "validate", doc}            -> core + umf.app + umf.ux validation
     {id, op: "validateActions", doc}     -> UMF's umf.actions validation
     {id, op: "compile", text, configuration} -> compileTableDeployment's result */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { registerAppVocabularies } from "@ux-builder/app-definition";

const entry = join(workerData.sdkDir, "node_modules", "@umf", "core", "package.json");
if (!existsSync(entry)) {
  parentPort.postMessage({ ready: false, error: `UMF's SDK is not installed. Run: npm run setup --workspace @ux-builder/studio (looked in ${workerData.sdkDir})` });
} else {
  const version = createRequire(entry)("./package.json").version;
  const umf = await import(pathToFileURL(join(dirname(entry), "dist", "umf-node.js")).href);
  // Two registries, both through UMF's public extension API: core + umf.app +
  // umf.ux, and UMF's own umf.actions validator (slow: it builds native
  // engines on every call, so it runs only when records or actions change).
  const registry = registerAppVocabularies(new umf.Registry());
  const actionsRegistry = umf.registerActions(new umf.Registry());
  const safe = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      return { ok: false, error: { code: e?.code ?? "UMF_ERROR", path: e?.path ?? "", message: String(e?.message ?? e) } };
    }
  };
  parentPort.on("message", (m) => {
    let out;
    if (m.op === "validate") out = safe(() => umf.validateDocument(m.doc, registry));
    else if (m.op === "validateActions") out = safe(() => umf.validateDocument(m.doc, actionsRegistry));
    else if (m.op === "compile") out = safe(() => umf.compileTableDeployment({ text: m.text, configuration: m.configuration }));
    else out = { ok: false, error: { code: "UNKNOWN_OP", path: "", message: `Unknown op ${m.op}` } };
    parentPort.postMessage({ id: m.id, ...out });
  });
  parentPort.postMessage({ ready: true, version });
}
