/* The sample organisation the studio runs against on one machine: a law firm,
   Harbor & Vale LLP (fictional), with its people and groups (served by the
   local identity provider, idp.ts) and its data catalog (served by the local
   Unity Catalog, catalog-server.ts). It exists so that sign-in, catalog
   browsing and per-person data permissions can be tried and tested without a
   real identity provider or Databricks workspace. Every name, figure and
   address in it is made up. */

export const ORG = { name: "Harbor & Vale LLP", short: "Harbor & Vale", catalog: "harbor" };

export type Group = { id: string; name: string; description: string };
export const GROUPS: Group[] = [
  { id: "partners", name: "Partners", description: "The firm's partners: every matter and the firm's finances" },
  { id: "litigation", name: "Litigation", description: "The litigation practice group" },
  { id: "corporate", name: "Corporate", description: "The corporate practice group" },
  { id: "finance", name: "Finance", description: "Billing, invoices and collections" },
  { id: "data-stewards", name: "Data stewards", description: "Keep client records correct" },
  { id: "hr", name: "People team", description: "Employees, including pay" },
  { id: "studio-builders", name: "Studio builders", description: "May build apps in UX Builder Studio" },
];

export type Person = { id: string; name: string; email: string; title: string; groups: string[]; about: string };
const at = (local: string) => `${local}@harborvale.example`;
export const PEOPLE: Person[] = [
  { id: "alex", name: "Alex Morgan", email: at("alex.morgan"), title: "Managing partner", groups: ["partners", "studio-builders"], about: "Sees every matter and the firm's finances; may change matters" },
  { id: "priya", name: "Priya Shah", email: at("priya.shah"), title: "Litigation associate", groups: ["litigation", "studio-builders"], about: "Sees litigation matters and their time only; matter budgets are hidden" },
  { id: "sam", name: "Sam Okafor", email: at("sam.okafor"), title: "Finance operations manager", groups: ["finance", "data-stewards", "studio-builders"], about: "Sees every matter and the finances; may change invoices and client records" },
  { id: "jordan", name: "Jordan Lee", email: at("jordan.lee"), title: "Head of people", groups: ["hr", "studio-builders"], about: "Sees employees with their pay; may change employee records" },
  { id: "casey", name: "Casey Brooks", email: at("casey.brooks"), title: "Corporate paralegal", groups: ["corporate"], about: "Not a builder: uses the apps shared with them; sees corporate matters" },
];
export const personById = (id: string) => PEOPLE.find((p) => p.id === id) ?? null;
export const personByEmail = (email: string) => PEOPLE.find((p) => p.email.toLowerCase() === String(email ?? "").toLowerCase()) ?? null;

/* ---------- the catalog ---------- */

export type ColumnSpec = {
  name: string;
  type: "STRING" | "INT" | "DECIMAL(12,2)" | "DECIMAL(6,2)" | "DATE" | "TIMESTAMP" | "BOOLEAN";
  comment: string;
  nullable?: boolean;
  /** Column mask: shown only to these groups; everyone else reads null. */
  mask?: { visibleTo: string[]; function: string; comment: string };
  /** A Delta CHECK constraint naming the allowed values. */
  values?: string[];
};
export type TableSpec = {
  name: string;
  comment: string;
  columns: ColumnSpec[];
  primaryKey: string;
  foreignKeys?: Array<{ column: string; references: string; parentColumn: string }>;
  select: string[];
  modify: string[];
  /** Row filter: a PostgreSQL condition on the row; sec.in_group(g) is the caller's membership. */
  rowFilter?: { function: string; columns: string[]; comment: string; sql: string };
};
export type SchemaSpec = { name: string; comment: string; use: string[]; tables: TableSpec[] };

const EVERYONE = GROUPS.map((g) => g.id);

export const SCHEMAS: SchemaSpec[] = [
  {
    name: "practice",
    comment: "Clients and matters: the work of the firm",
    use: EVERYONE,
    tables: [
      {
        name: "clients",
        comment: "The firm's clients, with their main contact",
        primaryKey: "client_id",
        select: EVERYONE,
        modify: ["data-stewards"],
        columns: [
          { name: "client_id", type: "STRING", comment: "Client number", nullable: false },
          { name: "name", type: "STRING", comment: "Client name", nullable: false },
          { name: "industry", type: "STRING", comment: "The client's industry" },
          { name: "city", type: "STRING", comment: "Where the client is based" },
          { name: "contact_name", type: "STRING", comment: "The client's main contact" },
          { name: "contact_email", type: "STRING", comment: "The main contact's email" },
          { name: "phone", type: "STRING", comment: "The main contact's phone" },
          { name: "status", type: "STRING", comment: "Whether the firm acts for the client now", values: ["active", "inactive"] },
        ],
      },
      {
        name: "matters",
        comment: "Each piece of work the firm does for a client",
        primaryKey: "matter_id",
        foreignKeys: [{ column: "client_id", references: "practice.clients", parentColumn: "client_id" }],
        select: EVERYONE,
        modify: ["partners"],
        rowFilter: {
          function: "matter_filter",
          columns: ["practice_group"],
          comment: "Partners and finance see every matter; everyone else sees the matters of their own practice group",
          sql: "sec.in_group('partners') or sec.in_group('finance') or sec.in_group(practice_group)",
        },
        columns: [
          { name: "matter_id", type: "STRING", comment: "Matter number", nullable: false },
          { name: "client_id", type: "STRING", comment: "The client the work is for", nullable: false },
          { name: "name", type: "STRING", comment: "Matter name", nullable: false },
          { name: "practice_group", type: "STRING", comment: "The practice group that does the work", values: ["litigation", "corporate", "employment", "real-estate"] },
          { name: "status", type: "STRING", comment: "Where the matter stands", values: ["open", "on hold", "closed"] },
          { name: "opened_on", type: "DATE", comment: "When the matter was opened" },
          { name: "closed_on", type: "DATE", comment: "When the matter was closed" },
          { name: "lead_partner", type: "STRING", comment: "The responsible partner's email" },
          { name: "budget", type: "DECIMAL(12,2)", comment: "The agreed fee budget", mask: { visibleTo: ["partners", "finance"], function: "budget_mask", comment: "Budgets are shown to partners and finance only" } },
        ],
      },
    ],
  },
  {
    name: "finance",
    comment: "Time, fees and invoices",
    use: ["partners", "finance", "litigation", "corporate"],
    tables: [
      {
        name: "time_entries",
        comment: "Time recorded against matters",
        primaryKey: "entry_id",
        foreignKeys: [{ column: "matter_id", references: "practice.matters", parentColumn: "matter_id" }],
        select: ["partners", "finance", "litigation", "corporate"],
        modify: ["finance"],
        rowFilter: {
          function: "time_filter",
          columns: ["matter_id"],
          comment: "Partners and finance see all time; everyone else sees the time on their practice group's matters",
          sql: "sec.in_group('partners') or sec.in_group('finance') or sec.matter_in_my_group(matter_id, current_user::text)",
        },
        columns: [
          { name: "entry_id", type: "STRING", comment: "Time entry number", nullable: false },
          { name: "matter_id", type: "STRING", comment: "The matter the time was for", nullable: false },
          { name: "timekeeper", type: "STRING", comment: "Who recorded the time (email)" },
          { name: "worked_on", type: "DATE", comment: "The day the work was done" },
          { name: "hours", type: "DECIMAL(6,2)", comment: "Hours worked" },
          { name: "rate", type: "DECIMAL(12,2)", comment: "Hourly rate charged" },
          { name: "amount", type: "DECIMAL(12,2)", comment: "Hours times rate" },
          { name: "billable", type: "BOOLEAN", comment: "Whether the time is charged to the client" },
          { name: "description", type: "STRING", comment: "What was done" },
        ],
      },
      {
        name: "invoices",
        comment: "Invoices sent to clients for matters",
        primaryKey: "invoice_id",
        foreignKeys: [{ column: "matter_id", references: "practice.matters", parentColumn: "matter_id" }],
        select: ["partners", "finance"],
        modify: ["finance"],
        columns: [
          { name: "invoice_id", type: "STRING", comment: "Invoice number", nullable: false },
          { name: "matter_id", type: "STRING", comment: "The matter invoiced", nullable: false },
          { name: "issued_on", type: "DATE", comment: "When the invoice was sent" },
          { name: "due_on", type: "DATE", comment: "When payment is due" },
          { name: "amount", type: "DECIMAL(12,2)", comment: "Invoice total" },
          { name: "status", type: "STRING", comment: "Where the invoice stands", values: ["draft", "sent", "paid", "overdue", "written off"] },
          { name: "paid_on", type: "DATE", comment: "When it was paid" },
        ],
      },
    ],
  },
  {
    name: "people",
    comment: "The firm's people",
    use: ["partners", "finance", "hr"],
    tables: [
      {
        name: "employees",
        comment: "Everyone who works at the firm",
        primaryKey: "employee_id",
        select: ["partners", "finance", "hr"],
        modify: ["hr"],
        columns: [
          { name: "employee_id", type: "STRING", comment: "Employee number", nullable: false },
          { name: "name", type: "STRING", comment: "Full name", nullable: false },
          { name: "title", type: "STRING", comment: "Job title" },
          { name: "practice_group", type: "STRING", comment: "Practice group, for lawyers", values: ["litigation", "corporate", "employment", "real-estate", "business services"] },
          { name: "email", type: "STRING", comment: "Work email" },
          { name: "office", type: "STRING", comment: "Office", values: ["Boston", "Chicago", "Denver"] },
          { name: "start_date", type: "DATE", comment: "First day at the firm" },
          { name: "billing_rate", type: "DECIMAL(12,2)", comment: "Standard hourly rate, for timekeepers" },
          { name: "salary", type: "DECIMAL(12,2)", comment: "Annual salary", mask: { visibleTo: ["hr"], function: "salary_mask", comment: "Pay is shown to the people team only" } },
        ],
      },
    ],
  },
];

/* A digest of the spec: the local catalog rebuilds its database when this changes. */
export const SPEC_VERSION = "harbor-1";

/* ---------- the data (deterministic) ---------- */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export type Rows = Record<string, Array<Record<string, string | number | boolean | null>>>;

export function sampleData(): Rows {
  const r = rng(20261117);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));

  const clientNames = [
    ["Northwind Logistics", "Logistics", "Boston"], ["Bluebird Health", "Healthcare", "Chicago"], ["Cobalt Ridge Energy", "Energy", "Denver"],
    ["Fernhill Foods", "Food and drink", "Chicago"], ["Granite Peak Software", "Technology", "Boston"], ["Harlow & Finch Retail", "Retail", "Boston"],
    ["Ironwood Manufacturing", "Manufacturing", "Chicago"], ["Juniper Lane Properties", "Real estate", "Denver"], ["Kestrel Aviation", "Transport", "Denver"],
    ["Lumen Biotech", "Life sciences", "Boston"], ["Meridian Credit Union", "Financial services", "Chicago"], ["Nightingale Care Homes", "Healthcare", "Boston"],
    ["Oakmont Hotels", "Hospitality", "Denver"], ["Pinecrest Schools Trust", "Education", "Chicago"], ["Quarry Street Media", "Media", "Boston"],
    ["Redwater Shipping", "Logistics", "Denver"], ["Saltmarsh Wind", "Energy", "Boston"], ["Tidewell Insurance", "Financial services", "Chicago"],
  ];
  const firsts = ["Avery", "Blake", "Cameron", "Dana", "Elliot", "Frankie", "Gray", "Harper", "Indra", "Jules", "Kai", "Logan", "Morgan", "Noor", "Oakley", "Parker", "Quinn", "Reese", "Sasha", "Taylor", "Uma", "Vic", "Wren", "Yuki", "Zion"];
  const lasts = ["Abbott", "Banerjee", "Castillo", "Dimitrov", "Eze", "Fischer", "Garcia", "Haddad", "Ito", "Jensen", "Kowalski", "Larsen", "Mensah", "Nakamura", "Ortiz", "Petrov", "Quigley", "Rossi", "Silva", "Tanaka", "Usman", "Varga", "Walsh", "Xu", "Young"];

  const clients = clientNames.map(([name, industry, city], i) => {
    const contact = `${pick(firsts)} ${pick(lasts)}`;
    return {
      client_id: `C-${String(101 + i)}`,
      name, industry, city,
      contact_name: contact,
      contact_email: `${contact.toLowerCase().replace(/[^a-z]+/g, ".")}@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
      phone: `(555) ${between(200, 989)}-${String(between(0, 9999)).padStart(4, "0")}`,
      status: i % 7 === 6 ? "inactive" : "active",
    };
  });

  // Employees: the five people who sign in, then the rest of the firm.
  const employees: Rows[string] = [];
  const emp = (name: string, title: string, group: string, email: string, office: string, rate: number | null, salary: number) =>
    employees.push({ employee_id: `E-${String(1001 + employees.length)}`, name, title, practice_group: group, email, office, start_date: addDays("2012-01-09", between(0, 4800)), billing_rate: rate, salary });
  emp("Alex Morgan", "Managing partner", "corporate", at("alex.morgan"), "Boston", 950, 820000);
  emp("Priya Shah", "Senior associate", "litigation", at("priya.shah"), "Chicago", 520, 245000);
  emp("Sam Okafor", "Finance operations manager", "business services", at("sam.okafor"), "Boston", null, 158000);
  emp("Jordan Lee", "Head of people", "business services", at("jordan.lee"), "Denver", null, 172000);
  emp("Casey Brooks", "Corporate paralegal", "corporate", at("casey.brooks"), "Boston", 210, 86000);
  const groups = ["litigation", "corporate", "employment", "real-estate"];
  const roles: Array<[string, number, number, number]> = [["Partner", 6, 820, 600000], ["Associate", 10, 450, 210000], ["Paralegal", 5, 200, 82000]];
  for (const [title, n, rate, salary] of roles) {
    for (let i = 0; i < n; i++) {
      const name = `${pick(firsts)} ${pick(lasts)}`;
      const group = groups[(i + title.length) % groups.length];
      emp(name, title, group, at(name.toLowerCase().replace(/[^a-z]+/g, ".")), pick(["Boston", "Chicago", "Denver"]), rate + between(-60, 80), salary + between(-20000, 40000));
    }
  }
  for (const t of ["Billing specialist", "Office manager", "IT lead", "Receptionist"]) emp(`${pick(firsts)} ${pick(lasts)}`, t, "business services", at(`${t.split(" ")[0].toLowerCase()}.${employees.length}`), pick(["Boston", "Chicago", "Denver"]), null, between(52000, 120000));

  const partners = employees.filter((e) => /partner/i.test(String(e.title)));
  const timekeepers = employees.filter((e) => e.billing_rate != null);

  // Matters: litigation and corporate get most of the work.
  const matters: Rows[string] = [];
  const kinds: Record<string, string[]> = {
    litigation: ["contract dispute", "product liability claim", "IP infringement suit", "insurance coverage dispute", "shareholder claim"],
    corporate: ["acquisition", "Series B financing", "joint venture", "credit facility", "board governance review"],
    employment: ["executive contract", "workplace investigation", "policy handbook"],
    "real-estate": ["office lease", "site acquisition", "zoning appeal"],
  };
  for (let i = 0; i < 48; i++) {
    const group = i % 5 < 2 ? "litigation" : i % 5 < 4 ? "corporate" : pick(["employment", "real-estate"]);
    const client = clients[(i * 7) % clients.length];
    const opened = addDays("2025-06-02", between(0, 470));
    const status = i % 6 === 5 ? "closed" : i % 11 === 10 ? "on hold" : "open";
    const lead = (partners.find((p) => p.practice_group === group) ?? partners[0]).email as string;
    matters.push({
      matter_id: `M-${2001 + i}`,
      client_id: client.client_id,
      name: `${client.name}: ${pick(kinds[group])}`,
      practice_group: group,
      status,
      opened_on: opened,
      closed_on: status === "closed" ? addDays(opened, between(60, 240)) : null,
      lead_partner: lead,
      budget: between(40, 600) * 1000,
    });
  }

  // Time: weekdays, January to October 2026, on open matters, by people in the matter's group.
  const time_entries: Rows[string] = [];
  const work = ["Research", "Drafting", "Client call", "Review of documents", "Negotiation", "Court filing", "Internal meeting", "Due diligence", "Correspondence"];
  let day = "2026-01-05";
  while (day <= "2026-10-30") {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) {
      for (let k = 0; k < 9; k++) {
        const m = matters[between(0, matters.length - 1)];
        if (m.status === "closed" && String(m.closed_on) < day) continue;
        if (String(m.opened_on) > day) continue;
        const people = timekeepers.filter((t) => t.practice_group === m.practice_group);
        const tk = people.length ? pick(people) : pick(timekeepers);
        const hours = between(1, 24) / 4;
        const rate = Number(tk.billing_rate);
        time_entries.push({
          entry_id: `T-${String(100001 + time_entries.length)}`,
          matter_id: m.matter_id,
          timekeeper: tk.email,
          worked_on: day,
          hours,
          rate,
          amount: Math.round(hours * rate * 100) / 100,
          billable: r() > 0.12,
          description: pick(work),
        });
      }
    }
    day = addDays(day, 1);
  }

  // Invoices: monthly per matter with billable time, from that month's time.
  const invoices: Rows[string] = [];
  const byMonth = new Map<string, number>();
  for (const t of time_entries) if (t.billable) {
    const key = `${t.matter_id}|${String(t.worked_on).slice(0, 7)}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(t.amount));
  }
  for (const [key, amount] of [...byMonth].sort()) {
    const [matter_id, month] = key.split("|");
    const issued = addDays(`${month}-01`, 34);
    if (issued > "2026-11-17") continue;
    const due = addDays(issued, 30);
    const age = (Date.parse("2026-11-17") - Date.parse(due)) / 86400000;
    const paid = r() < (age > 0 ? 0.82 : 0.3);
    const status = paid ? "paid" : age > 0 ? (r() < 0.06 ? "written off" : "overdue") : issued > "2026-11-10" ? "draft" : "sent";
    invoices.push({
      invoice_id: `INV-${String(5001 + invoices.length)}`,
      matter_id,
      issued_on: issued,
      due_on: due,
      amount: Math.round(amount * 100) / 100,
      status,
      paid_on: paid ? addDays(issued, between(8, 45)) : null,
    });
  }
  return { "practice.clients": clients, "practice.matters": matters, "finance.time_entries": time_entries, "finance.invoices": invoices, "people.employees": employees };
}
