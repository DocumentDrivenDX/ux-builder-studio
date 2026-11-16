/* The app room's host: the agent's actions here run through the same studio
   state and API as the person's own edits, after the same JSON Schema check
   the agent's input already passed. */
import { useMemo } from "react";
import Ajv from "ajv";
import { catalogData, type RoomResult } from "@ouispec/bindings";
import { useRoomRegistration } from "@ouispec/bindings/react";
import { appRoom, type AppCtx } from "./catalog";
import { describeProblem, PANELS, useStudio, type Panel } from "../../studio";

const DATA = catalogData(appRoom);
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = Object.fromEntries(appRoom.actions.map((a) => [a.id, ajv.compile(a.input as object)]));

export function AppRoom() {
  const s = useStudio();
  const ctx: AppCtx = useMemo(() => ({
    async applyOperations(input) {
      const r = await s.apply(input.operations as never, input.summary, "assistant");
      if (r.ok) return { ok: true, data: { version: r.version, databaseRedeployed: r.redeployed } };
      const problems = (r.errors ?? []).slice(0, 25).map(describeProblem);
      return { ok: false, code: r.code, message: problems.length ? `${r.message}\n- ${problems.join("\n- ")}` : r.message };
    },
    setPreview(input) {
      s.setTab("preview");
      if (input.person) {
        if (!s.people.some((p) => p.id === input.person)) return { ok: false, code: "UNKNOWN_PERSON", message: `No sample person ${input.person}; people: ${s.people.map((p) => p.id).join(", ")}` };
        s.setPerson(input.person);
      }
      if (input.screen) {
        const screens = s.view?.definition.extensions?.["umf.ux"]?.screens ?? [];
        if (!screens.some((x: any) => x.id === input.screen)) return { ok: false, code: "UNKNOWN_SCREEN", message: `No screen ${input.screen}` };
        s.setLocation({ screen: input.screen, param: input.param });
      }
      if (input.appearance) s.apply([{ op: "setLook", args: { appearance: input.appearance } }], `Preview in ${input.appearance} appearance`, "assistant");
      return { ok: true };
    },
    showPanel(input) {
      if (!PANELS.some((p) => p.id === input.panel)) return { ok: false, code: "UNKNOWN_PANEL", message: `No panel ${input.panel}` };
      s.setPanel(input.panel as Panel);
      return { ok: true };
    },
    async createVariant(input) {
      const r = await s.variant(input.name, input.note, "assistant");
      return r.ok ? { ok: true, data: { id: r.id } } : { ok: false, code: "VARIANT_FAILED", message: r.message ?? "Could not create the variant" };
    },
    async restoreVersion(input) {
      const r = await s.restore(input.version, "assistant");
      return r.ok ? { ok: true } : { ok: false, code: "RESTORE_FAILED", message: r.message ?? "Could not restore" };
    },
    async resetData() {
      await s.reset();
      return { ok: true };
    },
  }), [s]);

  const run = (actionId: string, input: Record<string, unknown>): RoomResult | Promise<RoomResult> => {
    const action = appRoom.actions.find((a) => a.id === actionId);
    const validate = validators[actionId];
    if (!action || !validate) return { ok: false, code: "UNKNOWN_ACTION", message: `No action ${actionId}` };
    if (!validate(input)) return { ok: false, code: "INVALID_INPUT", message: ajv.errorsText(validate.errors) };
    return action.run(ctx, input as never);
  };

  const def = s.view?.definition;
  const summary = s.view?.summary;
  const screens: string[] = (def?.extensions?.["umf.ux"]?.screens ?? []).map((x: any) => `${x.id}${x.param ? ` (param ${x.param.id})` : ""}`);
  useRoomRegistration(DATA, {
    run,
    observations: {
      definition: { id: def?.id ?? "", name: summary?.name ?? "", version: s.view?.version ?? 0, summary: JSON.stringify(summary ?? {}) },
      validation: {
        renderable: !!s.view?.verdict.renderable,
        errors: (s.view?.verdict.errors ?? []).map(describeProblem),
        warnings: (s.view?.verdict.warnings ?? []).map(describeProblem),
      },
      preview: { tab: s.tab, person: s.person?.id ?? "", screen: s.location?.screen ?? "", people: s.people.map((p) => `${p.id}: ${p.name} (${p.roles.join(", ")})`), screens },
    },
    problems: [],
  } as any);
  return null;
}
