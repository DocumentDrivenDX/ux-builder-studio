/* The contract between the app renderer (this package) and whatever serves an
   app's data (the studio server, or any other host). The renderer never talks
   to a database: it reads a snapshot of the rows the signed-in person may see,
   evaluates the definition's expressions against it, and asks the host to run
   umf.actions actions. The host enforces access, preconditions and
   authorization again; the renderer's checks only decide what to show. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A UMF document that is an app definition (app profile 0.1). */
export type AppDefinition = {
  umf: string;
  id: string;
  vocabularies: Record<string, { version: string }>;
  modules: Array<Record<string, unknown>>;
  extensions: Record<string, any>;
};

/** A person the preview can sign in as (umf.app samples.identities). */
export interface Identity {
  id: string;
  name: string;
  email?: string;
  roles: string[];
  /** The primary key of this person's row in the identity record, if any. */
  key?: string;
  attributes?: Record<string, Json>;
  note?: string;
}

/** A row: field values keyed by field name, derived values keyed by derived name. */
export type Row = Record<string, Json> & {
  /** The row's primary key value. */
  $key: string;
  /** The record element id, e.g. "invoice". */
  $record: string;
};

export interface Snapshot {
  /** Visible rows per record element id. */
  records: Record<string, Row[]>;
  /** The clock the preview runs at (ISO timestamp), from samples.clock or real time. */
  now: string;
  /** Monotonic revision of the data; changes after every action or reset. */
  revision: number;
}

export type ActionResult =
  | { ok: true; created?: { record: string; key: string }; changed: Array<{ record: string; key: string }>; message?: string }
  | { ok: false; code: string; message: string; field?: string };

export interface DataClient {
  /** The signed-in person. */
  identity: Identity;
  /** Every row this person may see, with derived values computed by the host. */
  snapshot(): Promise<Snapshot>;
  /** Run a umf.actions action with parameter values keyed by parameter id. Entity parameters take a row key. */
  run(action: string, params: Record<string, Json>): Promise<ActionResult>;
  /** Called after data changes (actions, resets, definition changes); returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Where the person is in the app: a screen and its one parameter. */
export interface Location {
  screen: string;
  param?: string;
}
