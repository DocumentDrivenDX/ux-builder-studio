/* How long UMF validation takes for the time tracker: a full validation, a
   change that does not touch records or actions, and a cached one. */
import { apply } from "@ux-builder/app-definition";
// @ts-ignore
import { buildDefinition } from "../fixtures/time-tracker.build.mjs";
import { starterDefinition } from "../server/apps.ts";
import { validateDefinition, loadUmf } from "../server/umf.ts";
let t = Date.now(); await loadUmf(); console.log("load", Date.now() - t);
const doc = await buildDefinition(apply, starterDefinition({ id: "app.tt-timing", name: "Time tracker" }));
t = Date.now(); const v = await validateDefinition(doc); console.log("full", Date.now() - t, v.valid, v.errors.length);
const doc2 = apply(doc, "setLook", { theme: "synaptiq" });
t = Date.now(); await validateDefinition(doc2); console.log("look change", Date.now() - t);
t = Date.now(); await validateDefinition(doc2); console.log("cached", Date.now() - t);
