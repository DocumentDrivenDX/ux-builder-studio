/* The app room: the app being built. The agent designs the app by applying
   operations here (validated by UMF on the server; a refused batch changes
   nothing), drives the live preview, and manages versions, variants and the
   preview's data. Pure: loaded by OUI's generator through Vite SSR. */
import type { RoomCatalog, RoomResult } from "@ouispec/bindings";
import { OPERATIONS_INPUT } from "@ux-builder/app-definition";

export interface AppCtx {
  applyOperations(input: { summary: string; operations: Array<{ op: string; args: unknown }> }): Promise<RoomResult>;
  setPreview(input: { person?: string; screen?: string; param?: string; appearance?: "system" | "light" | "dark" }): RoomResult;
  showPanel(input: { panel: string }): RoomResult;
  createVariant(input: { name: string; note?: string }): Promise<RoomResult>;
  restoreVersion(input: { version: number }): Promise<RoomResult>;
  resetData(): Promise<RoomResult>;
  captureBrand(input: { url: string }): Promise<RoomResult>;
  setBrandDesignSystem(input: { designSystem: string }): Promise<RoomResult>;
  chooseBrandOption(input: { option: string; name?: string }): Promise<RoomResult>;
  applyBrandKit(input: { kit: string }): Promise<RoomResult>;
  stopBrandKit(): Promise<RoomResult>;
}

export const appRoom: RoomCatalog<AppCtx> = {
  room: "app",
  title: "App builder",
  description: "The app open in the builder: its definition (data, roles, actions, screens, navigation, sample data), its validation, and its live preview.",
  actions: [
    {
      kind: "action",
      id: "apply-operations",
      title: "Apply changes",
      description: "Applies a batch of operations to the app's definition, in order, and saves one new version if UMF validates the result. A refused batch saves nothing and returns the problems to fix.",
      control: "The builder's edit panels (data, screens, actions, look)",
      input: OPERATIONS_INPUT as never,
      effect: "edit",
      run: (ctx, input) => ctx.applyOperations(input as never),
    },
    {
      kind: "action",
      id: "set-preview",
      title: "Set preview",
      description: "Shows the App preview tab, and optionally signs the live preview in as one of the app's sample people, opens one of its screens (with its parameter, a row key), or switches light/dark. With no input it only shows the preview; do so after changing the app, so the person sees the result.",
      control: "The App preview tab and its toolbar: Signed in as, screen and appearance",
      input: {
        type: "object",
        properties: {
          person: { type: "string", description: "A sample person's id (see observations)" },
          screen: { type: "string", description: "A screen id" },
          param: { type: "string", description: "The screen's parameter: a row key" },
          appearance: { type: "string", enum: ["system", "light", "dark"] },
        },
        additionalProperties: false,
      },
      effect: "edit",
      run: (ctx, input) => ctx.setPreview(input as never),
    },
    {
      kind: "action",
      id: "show-panel",
      title: "Show panel",
      description: "Shows the App configuration tab with one of its panels.",
      control: "The App configuration tab and its panel tabs",
      input: { type: "object", properties: { panel: { type: "string", enum: ["overview", "brand", "data", "screens", "actions", "diagrams", "rules", "versions", "deployment"] } }, required: ["panel"], additionalProperties: false },
      effect: "edit",
      run: (ctx, input) => ctx.showPanel(input as never),
    },
    {
      kind: "action",
      id: "create-variant",
      title: "Create variant",
      description: "Copies this app into a new catalog entry that records it as a variant of this one, and opens it.",
      control: "The Create variant button",
      input: { type: "object", properties: { name: { type: "string", minLength: 1 }, note: { type: "string", description: "What differs" } }, required: ["name"], additionalProperties: false },
      effect: "edit",
      run: (ctx, input) => ctx.createVariant(input as never),
    },
    {
      kind: "action",
      id: "restore-version",
      title: "Restore version",
      description: "Makes an earlier version of the definition the current one (as a new version).",
      control: "A version's Restore button in the Versions panel",
      input: { type: "object", properties: { version: { type: "integer", minimum: 1 } }, required: ["version"], additionalProperties: false },
      effect: "edit",
      destructive: true,
      run: (ctx, input) => ctx.restoreVersion(input as never),
    },
    {
      kind: "action",
      id: "reset-data",
      title: "Reset sample data",
      description: "Throws away every change made in the preview and reloads the app's sample data.",
      control: "The preview's Reset sample data button",
      input: { type: "object", properties: {}, additionalProperties: false },
      effect: "edit",
      destructive: true,
      run: (ctx) => ctx.resetData(),
    },
    {
      kind: "action",
      id: "capture-brand",
      title: "Get brand from a website",
      description: "Reads a website's brand on this computer (a screenshot, its CSS colours, fonts, button style and logo), shows it in the Brand and style panel, and makes three palette options that meet ux-builder's colour rules, on the design system the site's style suggests. Takes a few seconds. Returns the colours found, the design system and the option ids; nothing about the app changes until an option is chosen.",
      control: "The Brand and style panel's Website field and Get brand button",
      input: { type: "object", properties: { url: { type: "string", minLength: 3, description: "The website, such as www.example.com" } }, required: ["url"], additionalProperties: false },
      effect: "edit",
      run: (ctx, input) => ctx.captureBrand(input as never),
    },
    {
      kind: "action",
      id: "set-brand-design-system",
      title: "Show brand options on a design system",
      description: "Shows the captured brand's three options on another design system (control shapes, density and fonts). Needs a brand captured first.",
      control: "The Brand and style panel's Style (design system) picker",
      input: { type: "object", properties: { designSystem: { type: "string", enum: ["databricks", "material", "fluent", "carbon"] } }, required: ["designSystem"], additionalProperties: false },
      effect: "edit",
      run: (ctx, input) => ctx.setBrandDesignSystem(input as never),
    },
    {
      kind: "action",
      id: "choose-brand-option",
      title: "Use a brand option",
      description: "Keeps one of the captured brand's options as a brand kit in the studio's library (under the name given, else the site's name) and dresses the app in it. Choose for the person only when they ask you to.",
      control: "An option's Use this option button in the Brand and style panel",
      input: { type: "object", properties: { option: { type: "string", description: "An option id from the brand observation" }, name: { type: "string", description: "The kit's name" } }, required: ["option"], additionalProperties: false },
      effect: "edit",
      run: (ctx, input) => ctx.chooseBrandOption(input as never),
    },
    {
      kind: "action",
      id: "apply-brand-kit",
      title: "Use a brand kit",
      description: "Dresses the app in a brand kit already in the studio's library (see the brand observation's kits).",
      control: "A kit's Use button in the Brand and style panel's library",
      input: { type: "object", properties: { kit: { type: "string", description: "A kit id" } }, required: ["kit"], additionalProperties: false },
      effect: "edit",
      run: (ctx, input) => ctx.applyBrandKit(input as never),
    },
    {
      kind: "action",
      id: "stop-brand-kit",
      title: "Stop using the brand kit",
      description: "The app stops wearing its brand kit and shows its built-in theme again. The kit stays in the library.",
      control: "The Brand and style panel's Use the theme instead button",
      input: { type: "object", properties: {}, additionalProperties: false },
      effect: "edit",
      run: (ctx) => ctx.stopBrandKit(),
    },
  ],
  fields: [],
  commands: [],
  observations: [
    {
      id: "definition",
      description: "What the app holds: name, version, look, roles, records (fields and derived values), relationships, actions, screens, navigation, samples",
      schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, version: { type: "integer" }, summary: { type: "string", description: "The definition summary as JSON" } } },
    },
    {
      id: "validation",
      description: "UMF's verdict on the current definition: whether it renders, and every problem and warning to fix",
      schema: { type: "object", properties: { renderable: { type: "boolean" }, errors: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } } } },
    },
    {
      id: "preview",
      description: "The live preview: which builder tab is shown (configuration or preview), who the preview is signed in as, which screen it shows, and the people available",
      schema: { type: "object", properties: { tab: { type: "string", enum: ["configuration", "preview"] }, person: { type: "string" }, screen: { type: "string" }, people: { type: "array", items: { type: "string" } }, screens: { type: "array", items: { type: "string" } } } },
    },
    {
      id: "brand",
      description: "The app's look and the brand step: the theme or brand kit it wears, the website brand captured (colours and where each was seen, fonts, the suggested design system, the three options with what each does and any colour rules to review), and the kits in the library",
      schema: { type: "object", properties: { look: { type: "string" }, busy: { type: "string" }, capture: { type: "string", description: "The capture as JSON, or empty" }, kits: { type: "array", items: { type: "string" } } } },
    },
  ],
};
