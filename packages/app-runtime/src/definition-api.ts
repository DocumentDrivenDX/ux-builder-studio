/* Types for the parts of @ux-builder/app-definition (plain ESM, no type
   declarations) that the renderer uses: src/model.mjs, src/expr.mjs and
   src/engine.mjs. engine.ts re-exports those functions with these types, so
   the renderer type-checks the same in any program, whatever ambient
   declaration that program has for the package. Keep in step with those files. */

import type { ActionResult, Identity, Json } from "./contract";

export type { ActionResult, Identity };

/** A reference to a UMF element. */
export interface Ref {
  module: string;
  element: string;
}

/** A umf.app.expr rule: UMF's rule shape with a JSON-encoded expression tree. */
export interface Rule {
  language: "umf.app.expr";
  version: "1";
  expression: string;
  references: unknown[];
}

/** A parsed expression tree. */
export type Expr = Json | { [operator: string]: unknown };

export type FieldType =
  | "text" | "longtext" | "email" | "integer" | "number" | "money" | "hours" | "boolean"
  | "date" | "time" | "datetime" | "choice" | "id";

export type ScalarType = "string" | "boolean" | "integer" | "decimal" | "float" | "date" | "time" | "timestamp" | "uuid";

export interface FieldInfo {
  ref: Ref;
  id: string;
  /** The column name: rows are keyed by it. */
  name: string;
  title: string;
  description?: string;
  scalarType: ScalarType;
  /** The presentation type (umf.app fieldTypes, or one inferred from the scalar type). */
  type: FieldType;
  nullability: "required" | "absent-allowed" | "unspecified" | string;
  allowedValues: Json[];
  facets: Record<string, unknown>;
  semanticTypes: string[];
  /** The record that owns the field. */
  record: Ref;
}

export interface RecordInfo {
  ref: Ref;
  id: string;
  name: string;
  title: string;
  description?: string;
  fields: FieldInfo[];
  /** The primary key field's name. */
  keyName: string;
}

export interface RelationshipInfo {
  id: string;
  name?: string;
  module: string;
  source: Ref | null;
  target: Ref | null;
  sourceMultiplicity?: unknown;
  targetMultiplicity?: unknown;
  inverse?: unknown;
  /** The field of the source record that holds the target's key (from umf.app foreignKeys). */
  fieldName?: string;
}

export interface ActionParameter {
  id: string;
  kind: "value" | "entity";
  field?: Ref;
  target?: Ref & { key?: string };
  required?: boolean;
}

export interface ActionEffect {
  id: string;
  kind: "create" | "set" | "delete" | "link" | "unlink" | string;
  record?: Ref;
  entity?: { parameter?: string; created?: string };
  values?: Array<{ field: Ref; value: { parameter: string } | { literal: unknown } }>;
}

export interface ActionPrecondition {
  id: string;
  rule: Rule;
  failure?: { code: string; message: string };
}

export interface ActionDecl {
  id: string;
  name: string;
  description?: string;
  module: string;
  parameters: ActionParameter[];
  preconditions?: ActionPrecondition[];
  binding?: { kind: string; effects?: ActionEffect[] };
  authorization?: { kind: string; roles?: string[] };
}

export interface DerivedDecl {
  id: string;
  record: Ref;
  name: string;
  title?: string;
  description?: string;
  scalarType: ScalarType;
  format?: "text" | "number" | "currency" | "hours" | "date" | "datetime" | "time" | "percent" | "status";
  expression: Rule;
}

export interface RoleDecl {
  id: string;
  name: string;
  description?: string;
}

/** What indexDefinition returns. `app` is the umf.app extension and `ux` the umf.ux one. */
export interface DefinitionIndex {
  doc: unknown;
  app: any;
  ux: any;
  records: Map<string, RecordInfo>;
  fields: Map<string, FieldInfo>;
  relationships: Map<string, RelationshipInfo>;
  actions: Map<string, ActionDecl>;
  derived: Map<string, DerivedDecl[]>;
  screens: Map<string, any>;
  roles: Map<string, RoleDecl>;
  record(ref: Ref | string | null | undefined): RecordInfo | undefined;
  field(ref: Ref | string | null | undefined): FieldInfo | undefined;
  recordById(id: string): RecordInfo | undefined;
  relationshipByName(from: Ref | null | undefined, name: string): RelationshipInfo | undefined;
}

/** A row as the engine sees it: field values by name plus $key and $record. */
export type EngineRow = Record<string, any>;

/** The data part of an expression scope (engine makeScope). */
export interface DataScope {
  user: Record<string, any> | null;
  app: { name: string };
  $now: string;
  $rows(recordId: string): EngineRow[];
  $related(row: EngineRow | null | undefined, name: string): EngineRow[];
  [name: string]: unknown;
}

export interface MemoryHost {
  idx: DefinitionIndex;
  store: unknown;
  snapshot(who?: Identity): Promise<{ records: Record<string, EngineRow[]>; now: string; revision: number }>;
  run(who: Identity, action: string, params: Record<string, unknown>): Promise<ActionResult>;
  subscribe(listener: () => void): () => void;
}

