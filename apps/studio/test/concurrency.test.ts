/* Two changes to one app at the same moment both land, in order: neither is lost.
   The data folder is set before the app store loads (it reads it once), so the
   test never touches the studio's own catalog. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.STUDIO_PG_MEMORY = "1";
process.env.STUDIO_DATA_DIR = mkdtempSync(join(tmpdir(), "studio-concurrency-"));
const { applyOperations, createAppRecord, getApp } = await import("../server/apps.ts");

test("concurrent look changes are applied one after the other", async () => {
  await createAppRecord({ id: "app.concurrency", name: "Concurrency" });
  await Promise.all([
    applyOperations("app.concurrency", [{ op: "setLook", args: { theme: "synaptiq" } }]),
    applyOperations("app.concurrency", [{ op: "setLook", args: { appearance: "dark" } }]),
  ]);
  const { definition, history } = await getApp("app.concurrency");
  assert.equal(definition.extensions["umf.ux"].look.theme, "synaptiq");
  assert.equal(definition.extensions["umf.ux"].look.appearance, "dark");
  assert.equal(history.length, 3);
});
