/* The catalog room's host. */
import { useMemo } from "react";
import Ajv from "ajv";
import { catalogData, type RoomResult } from "@ouispec/bindings";
import { useRoomRegistration } from "@ouispec/bindings/react";
import { catalogRoom, type CatalogCtx } from "./catalog";
import { api, type CatalogEntry } from "../../api";
import { navigate } from "../../router";

const DATA = catalogData(catalogRoom);
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = Object.fromEntries(catalogRoom.actions.map((a) => [a.id, ajv.compile(a.input as object)]));

export function CatalogRoom({ apps }: { apps: CatalogEntry[] }) {
  const ctx: CatalogCtx = useMemo(() => ({
    async createApp(input) {
      try {
        const v = await api.createApp({ ...input, by: "assistant" });
        navigate(`/apps/${encodeURIComponent(v.definition.id)}`);
        return { ok: true, data: { appId: v.definition.id } };
      } catch (e: any) {
        return { ok: false, code: e?.body?.code ?? "CREATE_FAILED", message: e?.body?.message ?? String(e?.message ?? e) };
      }
    },
    openApp(input) {
      if (!apps.some((a) => a.id === input.appId)) return { ok: false, code: "UNKNOWN_APP", message: `No app ${input.appId}` };
      navigate(`/apps/${encodeURIComponent(input.appId)}`);
      return { ok: true };
    },
  }), [apps]);
  const run = (actionId: string, input: Record<string, unknown>): RoomResult | Promise<RoomResult> => {
    const action = catalogRoom.actions.find((a) => a.id === actionId);
    const validate = validators[actionId];
    if (!action || !validate) return { ok: false, code: "UNKNOWN_ACTION", message: `No action ${actionId}` };
    if (!validate(input)) return { ok: false, code: "INVALID_INPUT", message: ajv.errorsText(validate.errors) };
    return action.run(ctx, input as never);
  };
  useRoomRegistration(DATA, {
    run,
    observations: { catalog: { count: apps.length, apps: apps.map((a) => `${a.id}: ${a.name} (v${a.version})`) } },
    problems: [],
  } as any);
  return null;
}
