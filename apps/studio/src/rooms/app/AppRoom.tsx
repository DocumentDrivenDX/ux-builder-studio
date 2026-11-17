/* The app room's host: the agent's actions here run through the same studio
   state and API as the person's own edits, after the same JSON Schema check
   the agent's input already passed. */
import { useMemo } from "react";
import Ajv from "ajv";
import { catalogData, type RoomResult } from "@ouispec/bindings";
import { useRoomRegistration } from "@ouispec/bindings/react";
import { appRoom, type AppCtx } from "./catalog";
import { describeProblem, PANELS, useStudio, type Panel } from "../../studio";
import { useBrand, type BrandResult } from "../../brand/brand";
import { setStudioAppearance, useStudioAppearance } from "../../appearance";

const asRoom = (r: BrandResult): RoomResult => (r.ok ? { ok: true, ...(r.data ? { data: r.data } : {}) } : { ok: false, code: r.code, message: r.message });

const DATA = catalogData(appRoom);
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = Object.fromEntries(appRoom.actions.map((a) => [a.id, ajv.compile(a.input as object)]));

export function AppRoom() {
  const s = useStudio();
  const b = useBrand();
  const look = useStudioAppearance();
  const ctx: AppCtx = useMemo(() => ({
    setStudioAppearance: (input) => setStudioAppearance(look, input.appearance),
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
    async captureBrand(input) {
      s.setPanel("brand");
      return asRoom(await b.captureFromUrl(input.url));
    },
    async setBrandDesignSystem(input) {
      s.setPanel("brand");
      return asRoom(await b.setDesignSystem(input.designSystem));
    },
    async chooseBrandOption(input) {
      s.setPanel("brand");
      if (input.appearance) b.setAppearance(input.appearance);
      return asRoom(await b.chooseOption(input.option, input.name, "assistant"));
    },
    async adjustBrandOption({ option, ...adjust }) {
      s.setPanel("brand");
      return asRoom(await b.adjustOption(option, adjust as Record<string, number>));
    },
    resetBrandOption(input) {
      s.setPanel("brand");
      return asRoom(b.resetOption(input.option));
    },
    captureBrandLogo() {
      s.setPanel("brand");
      return { ok: true, data: { shown: "The Brand and style panel; the person adds the logo file there" } };
    },
    async applyBrandKit(input) {
      return asRoom(await b.applyKit(input.kit, "assistant"));
    },
    async stopBrandKit() {
      return asRoom(await b.stopUsingKit("assistant"));
    },
  }), [s, b, look]);

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
      brand: {
        look: b.current ? `brand kit ${b.current.id} (${b.current.name}: ${b.current.option.title}, ${b.current.designSystem} style)` : `theme ${def?.extensions?.["umf.ux"]?.look?.theme ?? "plain"}`,
        busy: b.busy ?? "",
        capture: b.capture ? JSON.stringify({
          site: b.capture.finalUrl, name: b.capture.name,
          colours: b.capture.analysis.colours.map((c) => `${c.hex} (${c.sources.map((x) => x.label).join(", ")})`),
          fonts: b.capture.analysis.fonts, style: b.capture.analysis.style.reason, designSystem: b.capture.designSystem,
          source: b.capture.source,
          styles: b.capture.styles.map((x) => `${x.name}${x.name === b.capture!.analysis.style.designSystem ? " (suggested)" : ""}: ${x.findings.length ? x.findings.map((f) => `${f.rule}: ${f.message}`).join("; ") : "meets the style rules"}`),
          defaultAppearance: b.appearance,
          options: b.options.map((o) => ({ id: o.id, title: o.title, description: o.description, buttons: o.swatches.light.structure, links: o.swatches.light.accent, page: o.swatches.light.ground, settings: o.settings, adjusted: o.adjusted ?? null, adjusting: b.live[o.id]?.problem ? `the person's last slider setting cannot meet the contrast rules: ${b.live[o.id]!.problem}` : null, review: o.findings.map((f) => `${f.rule} (${f.appearance}): ${f.message}`) })),
          notes: b.capture.notes,
        }) : "",
        kits: b.kits.map((k) => `${k.id}: ${k.name} (${k.option.title}, ${k.designSystem})`),
      },
      preview: { tab: s.tab, person: s.person?.id ?? "", screen: s.location?.screen ?? "", people: s.people.map((p) => `${p.id}: ${p.name} (${p.roles.join(", ")})`), screens },
    },
    problems: [],
  } as any);
  return null;
}
