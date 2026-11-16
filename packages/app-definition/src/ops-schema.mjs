/* JSON Schemas for the operations' arguments, with descriptions written for
   whoever calls them (the studio's agent, through the studio's "app" room).
   The same schemas validate input on the server before an operation runs.
   References to the definition use short names: a record by its id ("invoice"),
   a field by its name within a record ("status"); the operations expand them to
   UMF references. */

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const id = (description) => str(description, { pattern: "^[a-z][a-z0-9_-]{0,63}$" });
const name = (description) => str(description, { pattern: "^[a-z][a-z0-9_]{0,40}$" });
const ref = { type: "object", required: ["module", "element"], properties: { module: { type: "string" }, element: { type: "string" } }, additionalProperties: false };
const expr = { description: "An umf.app.expr expression tree (JSON Logic style), e.g. {\"==\":[{\"var\":\"row.status\"},\"draft\"]}. Operators: var, ==, !=, <, <=, >, >=, and, or, not, if, in, +, -, *, /, round, cat, coalesce, present, related, rows, filter, map, sum, count, min, max, some, all, today, now, date, add-days, start-of-week, hours." };
const field = {
  type: "object",
  required: ["name"],
  properties: {
    name: name("Column name, lower_snake_case, unique in the record."),
    type: { enum: ["text", "longtext", "email", "integer", "number", "money", "hours", "boolean", "date", "time", "datetime", "choice", "id"], description: "Presentation type; it decides the UMF scalar type (money/hours/number are exact decimals)." },
    title: str("Label people see."),
    description: str("What the field means."),
    required: { type: "boolean", description: "Default true." },
    values: { type: "array", items: {}, description: "For choice fields: the allowed values, in order." },
  },
  additionalProperties: false,
};

export const OPERATION_SCHEMAS = {
  setIdentity: {
    description: "Name and describe the app (catalog entry).",
    args: { type: "object", properties: { name: str("App name."), description: str("One sentence on what it does."), useCase: str("The requester's use case, in their words."), version: str("Semantic version."), template: { enum: ["tracker", "directory", "assistant", "request", "planner", "custom"] }, tags: { type: "array", items: { type: "string" } }, visibility: { enum: ["private", "shared", "catalog"] } }, additionalProperties: false },
  },
  setLook: {
    description: "Choose the app's theme (a @ux-builder/tokens theme name such as plain, synaptiq, databricks, praxis, praxis-material, praxis-fluentui, praxis-carbon) and default appearance.",
    args: { type: "object", properties: { theme: str("Theme name."), appearance: { enum: ["system", "light", "dark"] }, designSystem: { enum: ["databricks", "material", "fluent", "carbon", "own"] }, brandKit: str("Studio brand kit id, if the theme came from one.") }, additionalProperties: false },
  },
  setShell: { description: "App shell title and frame.", args: { type: "object", properties: { title: str("Shown in the top bar."), frame: { enum: ["side-nav", "top-nav", "top-bar"] } }, additionalProperties: false } },
  addRole: { description: "Add a role people can have (used by actions, screens, navigation and access).", args: { type: "object", required: ["id", "name"], properties: { id: id("Role id, e.g. employee."), name: str("Role name."), description: str("Who has it.") }, additionalProperties: false } },
  removeRole: { description: "Remove a role.", args: { type: "object", required: ["id"], properties: { id: id("Role id.") }, additionalProperties: false } },
  addRecord: {
    description: "Add a record (a table) with its fields. An `id` key field (type id) is added unless you name another key.",
    args: { type: "object", required: ["id", "fields"], properties: { id: name("Record id, singular lower_snake_case, e.g. invoice."), title: str("Singular label, e.g. Invoice."), description: str("What one row is."), fields: { type: "array", items: field }, key: name("Key field name (default id).") }, additionalProperties: false },
  },
  addField: { description: "Add a field to a record.", args: { type: "object", required: ["record", "field"], properties: { record: name("Record id."), field }, additionalProperties: false } },
  updateField: { description: "Change a field's type, title, description, required or allowed values.", args: { type: "object", required: ["record", "name", "changes"], properties: { record: name("Record id."), name: name("Field name."), changes: { type: "object", properties: { type: field.properties.type, title: { type: "string" }, description: { type: "string" }, required: { type: "boolean" }, values: { type: "array" } }, additionalProperties: false } }, additionalProperties: false } },
  removeField: { description: "Remove a field (not the key).", args: { type: "object", required: ["record", "name"], properties: { record: name("Record id."), name: name("Field name.") }, additionalProperties: false } },
  removeRecord: { description: "Remove a record with its fields, relationships, derived values, access rules and samples.", args: { type: "object", required: ["id"], properties: { id: name("Record id.") }, additionalProperties: false } },
  addRelationship: {
    description: "Link records many-to-one: each `from` row points at one `to` row through a key field on `from` (created if missing). Relationship id defaults to <from>_<field>; use it (or its name) in related() and in related/document regions, from either side.",
    args: { type: "object", required: ["from", "to"], properties: { id: id("Relationship id."), from: name("The many side, e.g. invoice_line."), to: name("The one side, e.g. invoice."), field: name("Key field on `from`, default <to>_id."), name: str("Unique relationship name, default its id."), required: { type: "boolean", description: "Must every `from` row have one? Default true." }, description: str("What the link means (for the conversation; not stored).") }, additionalProperties: false },
  },
  addDerived: {
    description: "A value computed per row and never stored (totals, amounts, counts, flags). The expression sees `row` (the record's row, including its fields and other derived values), related(), rows(), user, today/now.",
    args: { type: "object", required: ["record", "name", "expression"], properties: { id: id("Default <record>_<name>; columns refer to it as derived: <id>."), record: name("Record id."), name: name("Value name, not a field name."), title: str("Label."), type: { enum: ["number", "money", "hours", "integer", "text", "boolean", "date", "datetime"] }, format: { enum: ["text", "number", "currency", "hours", "date", "datetime", "time", "percent", "status"] }, description: str("What it means."), expression: expr }, additionalProperties: false },
  },
  removeDerived: { description: "Remove a derived value.", args: { type: "object", required: ["id"], properties: { id: id("Derived id.") }, additionalProperties: false } },
  addAccess: {
    description: "Who may see a record's rows. A record with no access rules is visible to every role; once it has rules, a row is visible only through one (role match and, if given, `when` true for the row). Replaces a rule with the same id.",
    args: { type: "object", required: ["record", "roles"], properties: { id: id("Rule id."), record: name("Record id."), roles: { type: "array", items: { type: "string" }, minItems: 1 }, when: expr, description: str("Why.") }, additionalProperties: false },
  },
  addAction: {
    description: "Something a person can do: create a row, update one (set fields, from inputs and/or fixed values), or delete one. `target` (default \"target\") is the row parameter for update/delete. Preconditions see params.<id> (params.target is the row, with derived values), user, rows(), today/now. Only listed roles may run it.",
    args: {
      type: "object",
      required: ["id", "record", "kind", "roles"],
      properties: {
        id: id("Action id, verb-first, e.g. submit-invoice."),
        name: str("Unique action name, e.g. Submit to accounts payable (placements may label the button differently)."),
        description: str("What happens."),
        record: name("The record it writes."),
        kind: { enum: ["create", "update", "delete"] },
        target: id("Row parameter id for update/delete (default target)."),
        inputs: { type: "array", items: { type: "string" }, description: "Field names supplied by the person or bound by the screen (for create: the new row's values; for update: the fields it changes)." },
        optional: { type: "array", items: { type: "string" }, description: "Inputs that may be left empty (their fields must be optional)." },
        set: { type: "object", description: "Fixed values: {field: value}, e.g. {\"status\":\"submitted\"}. null clears a field." },
        preconditions: { type: "array", items: { type: "object", required: ["id", "when", "message"], properties: { id: id("Condition id; its failure code is the upper-cased id."), when: expr, message: str("Shown when it does not hold, e.g. \"Add the receipt for every expense before submitting\".") }, additionalProperties: false } },
        roles: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      additionalProperties: false,
    },
  },
  removeAction: { description: "Remove an action (and stop offering it).", args: { type: "object", required: ["id"], properties: { id: id("Action id.") }, additionalProperties: false } },
  putScreen: {
    description: "Add or replace a screen (umf.ux). See the umf.ux knowledge for screen, region and placement shapes. Field references are {module, element} where element is <record>__<field>; records are {module, element:<record>}.",
    args: { type: "object", required: ["id", "title", "pattern", "regions"], properties: { id: id("Screen id."), title: {}, description: {}, pattern: { enum: ["collection", "record", "form", "schedule", "dashboard", "queue", "home"] }, roles: { type: "array", items: { type: "string" } }, param: { type: "object" }, back: { type: "object" }, actions: { type: "array" }, regions: { type: "array", minItems: 1 } }, additionalProperties: false },
  },
  removeScreen: { description: "Remove a screen and its navigation entries.", args: { type: "object", required: ["id"], properties: { id: id("Screen id.") }, additionalProperties: false } },
  setNavigation: {
    description: "Set the shell's navigation (destinations, per role) and the home screen per role.",
    args: { type: "object", properties: { navigation: { type: "array", items: { type: "object", required: ["id", "label", "screen"], properties: { id: id("Nav id."), label: { description: "Text, or a umf.app.expr rule (e.g. a count in the label)" }, icon: { type: "string", description: "One of: add arrow-left arrow-right calendar check check-circle chevron-down edit error external-link filter help home info lock menu more refresh search settings upload user view warning" }, screen: id("Screen id (a screen without a param)."), roles: { type: "array", items: { type: "string" } } }, additionalProperties: false } }, home: { type: "array", items: { type: "object", required: ["roles", "screen"], properties: { roles: { type: "array", items: { type: "string" } }, screen: { type: "string" } }, additionalProperties: false } } }, additionalProperties: false },
  },
  setSamples: { description: "Replace a record's sample rows (fabricated preview data; rows use field names; keys must be unique; relationship fields hold the target's key).", args: { type: "object", required: ["record", "rows"], properties: { record: name("Record id."), rows: { type: "array", items: { type: "object" } } }, additionalProperties: false } },
  setIdentities: { description: "Set the sample people the preview can sign in as, the record a person's row lives in, and the preview clock.", args: { type: "object", properties: { identities: { type: "array", items: { type: "object", required: ["id", "name", "roles"], properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" }, roles: { type: "array", items: { type: "string" } }, key: { description: "Key of this person's row in the identity record." }, note: { type: "string" } }, additionalProperties: false } }, record: name("Identity record id, e.g. person."), clock: str("ISO timestamp the preview runs at.") }, additionalProperties: false } },
  makeVariant: { description: "Not available as an operation; use the catalog's Create variant.", args: { type: "object", properties: {} } },
  applyPatch: { description: "Escape hatch: RFC 6902 add/replace/remove operations on the UMF document. Prefer the typed operations.", args: { type: "array", items: { type: "object", required: ["op", "path"], properties: { op: { enum: ["add", "replace", "remove"] }, path: { type: "string" }, value: {} } } } },
};

/* One room input: a batch of operations, applied in order and saved once. */
export const OPERATIONS_INPUT = {
  type: "object",
  required: ["summary", "operations"],
  properties: {
    summary: { type: "string", description: "One sentence for the version history, e.g. \"Add invoices with lines and expenses\"." },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        required: ["op", "args"],
        properties: {
          op: { enum: Object.keys(OPERATION_SCHEMAS).filter((k) => k !== "makeVariant") },
          args: { description: "The operation's arguments (see its schema in the knowledge)." },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
