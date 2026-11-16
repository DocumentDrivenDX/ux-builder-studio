/* The studio cites ux-builder's rules by id, in its validation messages and
   in what the App Expert is told; every id it cites must be one ux-builder's
   catalog has (at the commit the studio is pinned to). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..");
const catalog = new Set((JSON.parse(readFileSync(join(root, "vendor", "ux-builder", "guidelines", "rules.json"), "utf8")).rules as Array<{ id: string }>).map((r) => r.id));

test("every rule the app definition's checks cite is in ux-builder's catalog", () => {
  const source = readFileSync(join(root, "packages", "app-definition", "src", "semantics.mjs"), "utf8");
  const cited = [...source.matchAll(/"(?:error|warning)", "([a-z]+\.[a-z0-9-]+)"\)/g)].map((m) => m[1]);
  assert.ok(cited.length >= 5, "the checks cite rules");
  assert.deepEqual(cited.filter((id) => !catalog.has(id)), []);
});

test("the App Expert is given only rules in force", async () => {
  const { systemPrompt } = await import("../server/agent/knowledge.ts");
  const digest = systemPrompt().split("# Rules you follow")[1].split("\n# ")[0];
  const ids = [...digest.matchAll(/^- ([a-z]+\.[a-z0-9-]+) \(/gm)].map((m) => m[1]);
  assert.ok(ids.length > 10);
  assert.deepEqual(ids.filter((id) => !catalog.has(id)), []);
});
