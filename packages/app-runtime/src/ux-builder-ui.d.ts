/* @ux-builder/ui and @ux-builder/app-definition ship plain ESM with no type
   declarations. The renderer uses the widgets and patterns through these
   ambient modules, and the definition package through engine.ts, which gives
   each function its type (definition-api.ts). */
declare module "@ux-builder/ui";
declare module "@ux-builder/ui/patterns";
declare module "@ux-builder/app-definition";
