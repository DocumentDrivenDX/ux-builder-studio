#!/usr/bin/env node
/* Draws the diagrams the studio's documents use, with @ux-builder/visuals:
   the umf.visual documents in <source dir> (architecture, lifecycle and the
   like, written by hand), and the diagrams the studio reads from the time
   tracker's definition (data model, states, journey, flows, access), exactly
   as its Diagrams section shows them. Each is checked (text in its box, no
   crossings over budget, contrast), and written as <id>.svg (light, standalone)
   and <id>.md (its text version).

   node --import tsx scripts/doc-diagrams.mjs <source dir> <out dir> [--theme <name>]
   (npm run diagrams:docs -- <source dir> <out dir>) */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply, appDiagrams } from "@ux-builder/app-definition";
import { render, check, createTheme, loadTheme } from "@ux-builder/visuals/node";
import { buildDefinition } from "../fixtures/time-tracker.build.mjs";
import { starterDefinition } from "../server/apps.ts";

const [source, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const themeName = process.argv.includes("--theme") ? process.argv[process.argv.indexOf("--theme") + 1] : "ux-builder-databricks";
if (!source || !out) {
  console.error("usage: node --import tsx scripts/doc-diagrams.mjs <source dir> <out dir> [--theme <name>]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const theme = createTheme(loadTheme(themeName, "light"), "light");

// The time tracker as the App Expert builds it, from the recorded build.
const tracker = await buildDefinition(apply, starterDefinition({ id: "app.time-tracker", name: "Time tracker" }));

const docs = [
  ...readdirSync(source).filter((f) => f.endsWith(".json")).map((f) => ({ id: f.replace(/\.json$/, ""), doc: JSON.parse(readFileSync(join(source, f), "utf8")) })),
  ...appDiagrams(tracker).map((d) => ({ id: `time-tracker-${d.id}`, doc: d.doc })),
];

let failed = 0;
for (const { id, doc } of docs) {
  const r = await render(doc, { theme: themeName, appearance: "light", output: "svg" });
  const findings = check(r.layout, { theme });
  writeFileSync(join(out, `${id}.svg`), r.content);
  writeFileSync(join(out, `${id}.md`), r.text);
  if (findings.length) failed++;
  console.log(`${findings.length ? "FINDINGS" : "ok"} ${id}${findings.length ? `: ${findings.map((f) => `${f.code} ${f.item ?? ""}`).join("; ")}` : ""}`);
}
process.exit(failed ? 1 : 0);
