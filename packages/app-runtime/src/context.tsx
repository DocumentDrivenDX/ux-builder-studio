/* The renderer's React context: the runtime for the current snapshot, the
   data client, where the person is, and how to go elsewhere. */
import { createContext, useContext } from "react";
import type { ActionResult, DataClient, Json, Location } from "./contract";
import type { Runtime } from "./runtime";

/** What the renderer tells its host, so the host can observe the person's journey. */
export type AppEvent =
  | { type: "navigate"; location: Location; from?: Location }
  | { type: "action"; action: string; params: Record<string, Json>; result: ActionResult };

export interface AppContextValue {
  rt: Runtime;
  client: DataClient;
  /** True until the first snapshot for this client has arrived. */
  loading: boolean;
  location: Location;
  navigate(to: Location): void;
  reload(): Promise<void>;
  emit(event: AppEvent): void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("app-runtime: useApp() outside <AppView>");
  return v;
}

/** An href for a location; the renderer routes internally and never lets the browser follow it. */
export const hrefOf = (to: Location) => `#${encodeURIComponent(to.screen)}${to.param != null ? `/${encodeURIComponent(to.param)}` : ""}`;
