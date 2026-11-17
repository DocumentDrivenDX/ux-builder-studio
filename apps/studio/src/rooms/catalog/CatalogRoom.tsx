/* The catalog room's host. */
import { useEffect, useMemo, useState } from "react";
import Ajv from "ajv";
import { catalogData, type RoomResult } from "@ouispec/bindings";
import { useRoomRegistration } from "@ouispec/bindings/react";
import { catalogRoom, type CatalogCtx } from "./catalog";
import { api, type BrandKit, type CatalogEntry, type CatalogTree } from "../../api";
import { useSession } from "../../session";
import { navigate } from "../../router";
import { setStudioAppearance, useStudioAppearance } from "../../appearance";

const DATA = catalogData(catalogRoom);
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = Object.fromEntries(catalogRoom.actions.map((a) => [a.id, ajv.compile(a.input as object)]));

export function CatalogRoom({ apps }: { apps: CatalogEntry[] }) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [tree, setTree] = useState<CatalogTree | null>(null);
  const [catalogOn, setCatalogOn] = useState(false);
  const { me, catalog: canReadCatalog } = useSession();
  useEffect(() => { api.brandKits().then((r) => setKits(r.kits)).catch(() => {}); }, [apps]);
  useEffect(() => { api.catalog().then((c) => { setCatalogOn(c.available && canReadCatalog); if (c.available && canReadCatalog) api.catalogTree().then((r) => setTree(r.tree)).catch(() => {}); }).catch(() => {}); }, []);
  const look = useStudioAppearance();
  const ctx: CatalogCtx = useMemo(() => ({
    setStudioAppearance: (input) => setStudioAppearance(look, input.appearance),
    async createApp(input) {
      try {
        const kit = input.brandKit ? kits.find((k) => k.id === input.brandKit) : undefined;
        if (input.brandKit && !kit) return { ok: false, code: "UNKNOWN_KIT", message: `No brand kit ${input.brandKit}; kits: ${kits.map((k) => k.id).join(", ") || "none"}` };
        const v = await api.createApp({ ...input, ...(kit ? { designSystem: kit.designSystem } : {}), by: "assistant" });
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
  }), [apps, kits, look]);
  const run = (actionId: string, input: Record<string, unknown>): RoomResult | Promise<RoomResult> => {
    const action = catalogRoom.actions.find((a) => a.id === actionId);
    const validate = validators[actionId];
    if (!action || !validate) return { ok: false, code: "UNKNOWN_ACTION", message: `No action ${actionId}` };
    if (!validate(input)) return { ok: false, code: "INVALID_INPUT", message: ajv.errorsText(validate.errors) };
    return action.run(ctx, input as never);
  };
  useRoomRegistration(DATA, {
    run,
    observations: {
      catalog: { count: apps.length, apps: apps.map((a) => `${a.id}: ${a.name} (v${a.version})`), kits: kits.map((k) => `${k.id}: ${k.name} (${k.option.title}, ${k.designSystem})`) },
      dataCatalog: {
        available: catalogOn,
        person: me?.solo ? "working on their own: no organisation and no data catalog, so every app has its own data" : me ? `${me.name} (${me.groups.join(", ")}); ${me.builder ? "a studio builder" : "not a builder: may only use apps shared with them"}` : "nobody signed in",
        tables: (tree ?? []).flatMap((c) => c.schemas.flatMap((s) => s.tables.map((t) => `${t.fullName}: ${t.comment ?? ""} [${t.access.change ? "read and change" : "read only"}]`))),
      },
    },
    problems: [],
  } as any);
  return null;
}
