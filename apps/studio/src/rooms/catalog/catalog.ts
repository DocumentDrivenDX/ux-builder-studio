/* The catalog room: the studio's list of apps. Pure (loaded by OUI's generator
   through Vite SSR): no DOM at module scope. */
import type { RoomCatalog, RoomResult } from "@ouispec/bindings";

export interface CatalogCtx {
  createApp(input: { name: string; useCase?: string; description?: string; theme?: string }): Promise<RoomResult>;
  openApp(input: { appId: string }): RoomResult;
}

export const catalogRoom: RoomCatalog<CatalogCtx> = {
  room: "catalog",
  title: "App catalog",
  description: "Every app built in this studio. Creating an app opens it in the builder, where its data, screens and actions are designed.",
  actions: [
    {
      kind: "action",
      id: "create-app",
      title: "Create app",
      description: "Creates a new, empty app from the person's request and opens it in the builder. Use the person's own words for the use case.",
      control: "The New app form on the catalog page",
      input: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80, description: "Short app name, e.g. Time tracker" },
          useCase: { type: "string", maxLength: 2000, description: "What the person asked for, in their words" },
          description: { type: "string", maxLength: 300, description: "One sentence on what the app does" },
          theme: { type: "string", description: "Optional starting theme name (default plain)" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      effect: "edit",
      run: (ctx, input) => ctx.createApp(input as { name: string }),
    },
    {
      kind: "action",
      id: "open-app",
      title: "Open app",
      description: "Opens an existing app in the builder.",
      control: "An app's Open button in the catalog",
      input: { type: "object", properties: { appId: { type: "string", minLength: 1, description: "The app's id" } }, required: ["appId"], additionalProperties: false },
      effect: "view",
      run: (ctx, input) => ctx.openApp(input as { appId: string }),
    },
  ],
  fields: [],
  commands: [],
  observations: [
    {
      id: "catalog",
      description: "The apps in the catalog",
      schema: { type: "object", properties: { count: { type: "integer" }, apps: { type: "array", items: { type: "string" }, description: "Each app as \"<id>: <name> (v<version>)\"" } } },
    },
  ],
};
