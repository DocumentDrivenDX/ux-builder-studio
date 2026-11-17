/* The catalog room: the studio's list of apps. Pure (loaded by OUI's generator
   through Vite SSR): no DOM at module scope. */
import type { RoomCatalog, RoomResult } from "@ouispec/bindings";

export interface CatalogCtx {
  createApp(input: { name: string; useCase?: string; description?: string; theme?: string; brandKit?: string; appearance?: "system" | "light" | "dark" }): Promise<RoomResult>;
  openApp(input: { appId: string }): RoomResult;
  setStudioAppearance(input: { appearance: "light" | "dark" | "system" }): RoomResult;
}

export const catalogRoom: RoomCatalog<CatalogCtx> = {
  room: "catalog",
  title: "App catalog",
  description: "Every app built in this studio. Creating an app opens it in the builder, where its data, screens and actions are designed.",
  actions: [
    {
      kind: "action",
      id: "set-studio-appearance",
      title: "Set the studio's appearance",
      description: "Switches the studio itself to light or dark mode, or back to following the computer's setting (system), when the person asks. It does not change an app's look or its preview's appearance (that is the app's own appearance).",
      control: "The sun/moon button in the studio's top bar",
      input: { type: "object", properties: { appearance: { type: "string", enum: ["light", "dark", "system"], description: "light, dark, or system to follow the computer's setting" } }, required: ["appearance"], additionalProperties: false },
      effect: "view",
      run: (ctx, input) => ctx.setStudioAppearance(input as never),
    },
    {
      kind: "action",
      id: "create-app",
      title: "Create app",
      description: "Creates a new, empty app from the person's request and opens it in the builder. Use the person's own words for the use case. Give a brand kit if the person named one; for a website, create the app, then use the app room's capture-brand action.",
      control: "The New app form on the catalog page",
      input: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80, description: "Short app name, e.g. Time tracker" },
          useCase: { type: "string", maxLength: 2000, description: "What the person asked for, in their words" },
          description: { type: "string", maxLength: 300, description: "One sentence on what the app does" },
          theme: { type: "string", description: "Optional starting built-in theme (default plain)" },
          brandKit: { type: "string", description: "Optional brand kit from the library the app wears from the start (see the catalog observation's kits)" },
          appearance: { type: "string", enum: ["system", "light", "dark"], description: "Optional default appearance" },
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
      schema: { type: "object", properties: { count: { type: "integer" }, apps: { type: "array", items: { type: "string" }, description: "Each app as \"<id>: <name> (v<version>)\"" }, kits: { type: "array", items: { type: "string" }, description: "The brand kits in the library, each as \"<id>: <name> (<option>, <design system>)\"" } } },
    },
  ],
};
