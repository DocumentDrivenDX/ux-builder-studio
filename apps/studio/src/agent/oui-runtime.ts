/* The tab's OUI runtime: one per tab. connectBindings keeps it equal to what
   the generated manifest declares and what is mounted right now (bound
   controls and rooms), so the agent only ever sees controls a person can use. */
import { acceptCurrentTurn, createSurfaceRuntime } from "oui-spec/core";
import { createBindingRegistry, type GeneratedKnowledge, type OuiManifest } from "@ouispec/bindings";
import { connectBindings } from "@ouispec/bindings/oui";
import manifest from "./generated/oui-manifest.json";
import knowledge from "./generated/oui-knowledge.json";
import { navigation } from "../router";

let acceptedTurn: () => string | null = () => null;
export const setAcceptedTurnReader = (read: (() => string | null) | null) => {
  acceptedTurn = read ?? (() => null);
};

export const ouiRuntime = createSurfaceRuntime({ form: "index", announce: false, accept: acceptCurrentTurn(() => acceptedTurn()) } as any);
export const bindingRegistry = createBindingRegistry();
export const ouiManifest = manifest as unknown as OuiManifest;
export const uiKnowledge = knowledge as unknown as GeneratedKnowledge;

export const bindingDefects: unknown[] = [];
connectBindings({
  registry: bindingRegistry,
  runtime: ouiRuntime as any,
  manifest: ouiManifest,
  navigation,
  onDefect: (d) => {
    bindingDefects.push(d);
    console.error("OUI binding defect", d);
  },
});
