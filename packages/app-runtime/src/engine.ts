/* @ux-builder/app-definition's functions, typed (definition-api.ts). The
   package is plain ESM with no declarations, so each import is given its
   signature here once; the rest of the renderer imports from this module. */
import * as definition from "@ux-builder/app-definition";
import type { DataScope, DefinitionIndex, EngineRow, Expr, Identity, MemoryHost, Ref, Rule } from "./definition-api";

const lib = definition as unknown as Record<string, unknown>;

export const indexDefinition = lib.indexDefinition as (doc: unknown) => DefinitionIndex;
export const refKey = lib.refKey as (ref: Ref | null | undefined) => string;
export const humanize = lib.humanize as (id: string) => string;
export const parseRule = lib.parseRule as (rule: Rule | Expr | null | undefined) => Expr | null;
export const evaluate = lib.evaluate as (tree: Expr | null, scope?: Record<string, unknown>) => any;
export const makeScope = lib.makeScope as (idx: DefinitionIndex, rowsByRecord: Record<string, EngineRow[]>, identity: Identity | null | undefined, now?: string) => DataScope;
export const related = lib.related as (idx: DefinitionIndex, rowsByRecord: Record<string, EngineRow[]>, row: EngineRow | null | undefined, name: string) => EngineRow[];
export const mayRun = lib.mayRun as (idx: DefinitionIndex, actionId: string, identity: Identity | null | undefined) => boolean;
export const memoryHost = lib.memoryHost as (doc: unknown, options?: { identity?: Identity; now?: string }) => MemoryHost;
