/* The catalog room: the studio's list of apps. Pure (loaded by OUI's generator
   through Vite SSR): no DOM at module scope. */
import type { RoomCatalog, RoomResult } from "@ouispec/bindings";

export interface CatalogCtx {
  createApp(input: { name: string; useCase?: string; description?: string; theme?: string; brandKit?: string; appearance?: "system" | "light" | "dark"; kind?: "reporting" | "data-management" | "own-data"; sources?: Array<{ asset: string; access?: "read" | "change" }> }): Promise<RoomResult>;
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
      description: "Creates a new app from the person's request and opens it in the builder. Use the person's own words for the use case. Give a brand kit if the person named one; for a website, create the app, then use the app room's capture-brand action. Its kind: reporting (dashboards and lists over data-catalog tables, read only), data-management (look up, add and correct rows in catalog tables the person may change), or own-data (its own data model, designed here; the default). For reporting and data-management, give the catalog tables (see the dataCatalog observation, which lists only what the person may read, and what they may change): the studio makes a first version from them at once, read as the person.",
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
          kind: { type: "string", enum: ["reporting", "data-management", "own-data"], description: "What the app is for (default own-data)" },
          sources: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            description: "For reporting or data-management: the catalog tables, by full name, and whether the app changes each (change only where the dataCatalog observation says the person may)",
            items: { type: "object", properties: { asset: { type: "string", pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$", description: "catalog.schema.table" }, access: { type: "string", enum: ["read", "change"], description: "Default read" } }, required: ["asset"], additionalProperties: false },
          },
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
    {
      id: "dataCatalog",
      description: "The organisation's data catalog as the signed-in person sees it: who they are, and every table they may read, with what they may do with it",
      schema: {
        type: "object",
        properties: {
          available: { type: "boolean" },
          person: { type: "string", description: "\"<name> (<groups>)\"; builder or not" },
          tables: { type: "array", items: { type: "string" }, description: "Each table as \"<catalog.schema.table>: <comment> [read only | read and change]\"" },
        },
      },
    },
  ],
};
