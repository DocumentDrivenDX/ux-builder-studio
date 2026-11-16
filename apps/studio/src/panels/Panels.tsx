/* The builder's panels: what the app is made of, in words a business user can
   follow (no JSON), plus UMF's verdict, the version history and the database
   UMF deploys. */
import { useEffect, useState } from "react";
import { Card, DataTable, Notice, StatusPill } from "@ux-builder/ui";
import { DescriptionList, Stack } from "@ux-builder/ui/patterns";
import { indexDefinition, parseRule } from "@ux-builder/app-definition";
import { Button } from "../agent/generated/bound/ux-builder-ui";
import { api } from "../api";
import { useStudio } from "../studio";

const list = (v: any) => (Array.isArray(v) ? v : []);
const TYPE_LABEL: Record<string, string> = { text: "Text", longtext: "Long text", email: "Email", integer: "Whole number", number: "Number", money: "Money", hours: "Hours", boolean: "Yes / no", date: "Date", time: "Time", datetime: "Date and time", choice: "Choice", id: "Identifier" };

function exprText(r: unknown) {
  try {
    return JSON.stringify(parseRule(r));
  } catch {
    return String(r);
  }
}

export function OverviewPanel() {
  const { view } = useStudio();
  if (!view) return null;
  const app = view.definition.extensions["umf.app"];
  return (
    <Stack gap={4}>
      {!view.verdict.renderable ? <Notice tone="error" title="This version cannot render">Open Rules to see why.</Notice> : null}
      <DescriptionList
        items={[
          { label: "Name", value: app.name },
          { label: "What it does", value: app.description || "—", wide: true },
          { label: "Use case", value: app.useCase || "—", wide: true },
          { label: "Version", value: `${app.version} (revision ${view.version})` },
          { label: "Template", value: app.template ?? "custom" },
          { label: "Visibility", value: app.visibility ?? "private" },
          { label: "Variant of", value: app.variantOf ? `${app.variantOf.id} v${app.variantOf.version}${app.variantOf.note ? `: ${app.variantOf.note}` : ""}` : "—" },
          { label: "Roles", value: list(app.roles).map((r: any) => r.name).join(", ") },
          { label: "Records", value: String(view.summary?.records?.length ?? 0) },
          { label: "Screens", value: String(view.summary?.screens?.length ?? 0) },
        ]}
      />
    </Stack>
  );
}

export function DataPanel() {
  const { view } = useStudio();
  if (!view) return null;
  const idx = indexDefinition(view.definition);
  const records = [...idx.records.values()] as any[];
  if (!records.length) return <Notice tone="info" title="No data yet">The assistant adds records (like Invoice or Project) as it designs the app.</Notice>;
  return (
    <Stack gap={4}>
      {records.map((rec) => {
        const derived = list(idx.derived.get(`${rec.ref.module}/${rec.ref.element}`));
        const access = list(idx.app.access).filter((a: any) => a.record.element === rec.id);
        const rels = [...idx.relationships.values()].filter((r: any) => r.source?.element === rec.id) as any[];
        return (
          <Card key={rec.id} title={rec.title}>
            <Stack gap={3}>
              {rec.description ? <p>{rec.description}</p> : null}
              <DataTable
                caption={`${rec.title} fields`}
                pageSize={50}
                columns={[{ key: "title", label: "Field" }, { key: "type", label: "Type" }, { key: "required", label: "Required" }, { key: "values", label: "Allowed values" }]}
                rows={rec.fields.map((f: any) => ({ id: f.name, title: f.title, type: TYPE_LABEL[f.type] ?? f.type, required: f.nullability === "required" ? "Yes" : "No", values: f.allowedValues.join(", ") || "—" }))}
              />
              {derived.length ? <DescriptionList items={derived.map((d: any) => ({ label: `${d.title} (calculated)`, value: exprText(d.expression), wide: true }))} /> : null}
              {rels.length ? <p className="studio-meta">Links: {rels.map((r) => `${r.fieldName ?? "?"} → ${idx.record(r.target)?.title}`).join("; ")}</p> : null}
              {access.length ? <p className="studio-meta">Who sees rows: {access.map((a: any) => `${a.roles.join(", ")}${a.when ? ` when ${exprText(a.when)}` : ""}`).join("; ")}</p> : <p className="studio-meta">Every role sees every row.</p>}
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

export function ScreensPanel() {
  const { view } = useStudio();
  if (!view) return null;
  const ux = view.definition.extensions["umf.ux"];
  return (
    <Stack gap={4}>
      <p className="studio-meta">Navigation: {list(ux.shell?.navigation).map((n: any) => `${typeof n.label === "string" ? n.label : n.id}${n.roles?.length ? ` (${n.roles.join(", ")})` : ""}`).join(" · ")}</p>
      {list(ux.screens).map((s: any) => (
        <Card key={s.id} title={typeof s.title === "string" ? s.title : s.id}>
          <Stack gap={2}>
            <p className="studio-meta">{s.pattern} screen{s.roles?.length ? ` for ${s.roles.join(", ")}` : " for everyone"}{s.param ? ` · opens one ${s.param.record.element}` : ""}</p>
            <ul className="studio-list">
              {list(s.regions).map((r: any) => (
                <li key={r.id}>{r.kind}{r.title && typeof r.title === "string" ? `: ${r.title}` : ""}{r.record ? ` (${r.record.element})` : r.relationship ? ` (${r.relationship})` : r.action ? ` (${r.action})` : ""}</li>
              ))}
            </ul>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export function ActionsPanel() {
  const { view } = useStudio();
  if (!view) return null;
  const idx = indexDefinition(view.definition);
  const actions = [...idx.actions.values()] as any[];
  if (!actions.length) return <Notice tone="info" title="No actions yet">Actions are what people can do: submit, approve, return, pay.</Notice>;
  return (
    <DataTable
      caption="Actions"
      pageSize={50}
      columns={[{ key: "name", label: "Action" }, { key: "who", label: "Who" }, { key: "does", label: "What it does" }, { key: "checks", label: "Checks" }]}
      rows={actions.map((a) => ({
        id: a.id,
        name: a.name,
        who: list(a.authorization?.roles).map((r: string) => idx.roles.get(r)?.name ?? r).join(", "),
        does: list(a.binding?.effects).map((e: any) => (e.kind === "create" ? `adds a ${e.record.element}` : e.kind === "delete" ? "deletes the row" : `sets ${list(e.values).map((v: any) => idx.field(v.field)?.name).join(", ")}`)).join("; "),
        checks: list(a.preconditions).map((c: any) => c.failure?.message).join("; ") || "—",
      }))}
    />
  );
}

export function RulesPanel() {
  const { view } = useStudio();
  if (!view) return null;
  const { errors, warnings, renderable } = view.verdict;
  return (
    <Stack gap={3}>
      {renderable && !warnings.length ? <Notice tone="success" title="UMF validated this version">Every reference resolves, the UX rules hold, and the app renders.</Notice> : null}
      {errors.map((d, i) => <Notice key={`e${i}`} tone="error" title={d.message}>{d.code} at {d.path || "/"}</Notice>)}
      {warnings.map((d, i) => <Notice key={`w${i}`} tone="warning" title={d.message}>{d.code} at {d.path || "/"}</Notice>)}
    </Stack>
  );
}

export function VersionsPanel() {
  const { view, restore } = useStudio();
  if (!view) return null;
  const rows = [...view.history].reverse();
  return (
    <Stack gap={3}>
      {rows.map((h) => (
        <Card key={h.version} title={`Version ${h.version}`}>
          <Stack gap={2}>
            <p>{h.summary}</p>
            <p className="studio-meta">
              {new Date(h.at).toLocaleString()} · by {h.by === "assistant" ? "the assistant" : h.by}
              {h.operations?.length ? ` · ${h.operations.length} change${h.operations.length === 1 ? "" : "s"}` : ""}
            </p>
            {h.version === view.version ? <StatusPill state="live">Current</StatusPill> : (
              <div><Button variant="secondary" size="sm" onClick={() => restore(h.version)} agent={{ nonAgent: "restoring is the app room's restore-version action" }}>Restore</Button></div>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export function DeploymentPanel() {
  const { appId, view } = useStudio();
  const [dep, setDep] = useState<{ schema: string; steps: Array<{ id: string; kind: string; sql: string }>; digest: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDep(null);
    api.deployment(appId).then(setDep, (e) => setError(e?.body?.message ?? String(e?.message ?? e)));
  }, [appId, view?.version]);
  if (error) return <Notice tone="error" title="UMF could not compile the deployment">{error}</Notice>;
  if (!dep) return <p className="studio-meta">Compiling…</p>;
  const count = (k: string) => dep.steps.filter((s) => s.kind === k).length;
  return (
    <Stack gap={3}>
      <Notice tone="info" title="PostgreSQL tables, generated by UMF">
        UMF's table compiler turned this app's records into {count("table")} tables with {count("foreignKey")} foreign keys and {count("policy")} row-level policies in schema {dep.schema}. The studio applies this SQL and seeds the sample data.
      </Notice>
      <pre className="studio-sql" tabIndex={0}>{dep.steps.map((s) => `${s.sql.trim().replace(/;?$/, ";")}`).join("\n")}</pre>
    </Stack>
  );
}
