/* The umf.ux 0.1 shapes the renderer reads (vocabularies/umf.ux.0.1.0.json).
   A definition that validates guarantees these; the renderer still reads
   every optional part defensively, so a half-edited definition in the studio
   renders what it can. */
import type { Ref, Rule } from "./definition-api";

export type { Ref, Rule };

/** Literal text, or an expression whose value is the text. */
export type Text = string | Rule;

export type Format = "text" | "number" | "currency" | "hours" | "date" | "datetime" | "time" | "percent" | "status" | "email" | "multiline";

export type Tone = "live" | "limited" | "purchasing" | "evaluation" | "closed" | "neutral";

export type StatusMap = Record<string, { tone: Tone; label?: string }>;

export interface Navigate {
  screen: string;
  /** The value passed as the target screen's parameter. */
  param?: Rule;
}

/** A column or display value: a core field, a derived value (by id) or an expression. */
export interface ValueRef {
  field?: Ref;
  derived?: string;
  value?: Rule;
  label?: string;
  format?: Format;
  status?: StatusMap;
  link?: Navigate;
  secondary?: Rule;
  priority?: boolean;
  numeric?: boolean;
  wide?: boolean;
}

export interface Binding {
  parameter: string;
  from?: "row" | "param" | "user" | "value" | "selection" | "input";
  value?: Rule;
}

export type ControlKind = "text" | "textarea" | "number" | "currency" | "hours" | "date" | "time" | "datetime" | "select" | "choice" | "checkbox" | "switch" | "email" | "file";

export interface Control {
  parameter: string;
  label?: string;
  hint?: string;
  control?: ControlKind;
  options?: {
    record?: Ref;
    label?: Ref;
    filter?: Rule;
    values?: Array<{ value: unknown; label: string }>;
  };
  default?: Rule;
}

export interface Success {
  toast?: Text;
  navigate?: Navigate;
}

export interface Placement {
  action: string;
  label?: string;
  emphasis?: "primary" | "secondary" | "text" | "destructive";
  bind?: Binding[];
  inputs?: Control[];
  confirm?: { title: Text; message?: Text; confirmLabel?: string };
  when?: Rule;
  roles?: string[];
  success?: Success;
}

export interface Empty {
  title: Text;
  message?: Text;
}

export interface DocumentSection {
  id: string;
  title?: Text;
  fields?: ValueRef[];
  relationship?: string;
  columns?: ValueRef[];
  rowActions?: Placement[];
  totals?: ValueRef[];
  empty?: Text;
}

export type RegionKind = "collection" | "record" | "related" | "form" | "schedule" | "stats" | "chart" | "notice" | "actions" | "document";

export interface Region {
  id: string;
  kind: RegionKind;
  title?: Text;
  description?: Text;
  when?: Rule;
  roles?: string[];

  record?: Ref;
  relationship?: string;
  filter?: Rule;
  sort?: Array<{ by: ValueRef; direction?: "ascending" | "descending" }>;
  columns?: ValueRef[];
  fields?: ValueRef[];
  search?: Ref[];
  groupBy?: ValueRef;
  rowActions?: Placement[];
  bulkActions?: Placement[];
  rowLink?: Navigate;
  empty?: Empty;
  totals?: ValueRef[];

  action?: string;
  inputs?: Control[];
  bind?: Binding[];
  submitLabel?: string;
  success?: Success;

  start?: Ref;
  end?: Ref;
  label?: ValueRef;
  detail?: ValueRef;
  colorBy?: ValueRef;
  hours?: { from?: number; to?: number };
  eventActions?: Placement[];
  legend?: Array<{ label: string; description?: string }>;

  tiles?: Array<{ label: string; value: Rule; format?: "text" | "number" | "currency" | "hours" | "percent" }>;

  /** chart: the kind of chart, what each bar or point shows, date periods for groupBy, and the most groups shown. */
  chart?: "bar" | "column" | "line";
  measure?: { aggregate: "count" | "sum" | "average" | "min" | "max"; field?: Ref; derived?: string; label?: string; format?: "number" | "currency" | "hours" | "percent" };
  bucket?: "day" | "week" | "month" | "quarter" | "year";
  limit?: number;

  tone?: "info" | "accent" | "success" | "warning" | "error";
  message?: Text;

  items?: Placement[];

  sections?: DocumentSection[];
}

export interface Screen {
  id: string;
  title: Text;
  description?: Text;
  pattern: "collection" | "record" | "form" | "schedule" | "dashboard" | "queue" | "home";
  roles?: string[];
  param?: { id: string; record: Ref };
  back?: Navigate;
  actions?: Placement[];
  regions: Region[];
}

export interface NavItem {
  id: string;
  label: Text;
  icon?: string;
  screen: string;
  roles?: string[];
}

export interface UxExtension {
  modality: "responsive-web";
  look: { theme: string; appearance?: "system" | "light" | "dark"; designSystem?: string; brandKit?: string };
  shell: {
    title: string;
    frame: "side-nav" | "top-nav" | "top-bar";
    navigation: NavItem[];
    home?: Array<{ roles: string[]; screen: string }>;
  };
  screens: Screen[];
}
