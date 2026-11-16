/* Diagrams of the open app, read from its definition (never drawn by hand):
   the data model, each status's states, each role's screens and paths, how a
   record moves between people, and who can do what. @ux-builder/visuals
   draws them in the studio's theme, with a text version for screen readers;
   each can be downloaded as SVG, or as Mermaid (a Markdown table for the
   access matrix) to paste into documents. */
import { useMemo, useRef, useState } from "react";
import { Notice } from "@ux-builder/ui";
import { Cluster, Stack } from "@ux-builder/ui/patterns";
import { appDiagrams, DIAGRAM_GROUPS } from "@ux-builder/app-definition";
import { render } from "@ux-builder/visuals";
import { Visual, themeAt } from "@ux-builder/visuals/react";
import { Button, Select, Switch } from "../agent/generated/bound/ux-builder-ui";
import { useStudio } from "../studio";

type Diagram = { id: string; group: string; title: string; description: string; doc: any };

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DiagramsPanel() {
  const { view } = useStudio();
  const [derived, setDerived] = useState(false);
  const [fit, setFit] = useState(true);
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const def = view?.definition;
  const diagrams: Diagram[] = useMemo(() => (def ? appDiagrams(def, { derived }) : []), [def, derived]);
  if (!def) return null;
  if (!diagrams.length) {
    return <Notice tone="info" title="No diagrams yet">Diagrams appear as the app gains records, roles, actions and screens.</Notice>;
  }
  const current = diagrams.find((d) => d.id === chosen) ?? diagrams[0];
  const group = (id: string) => (DIAGRAM_GROUPS as Array<{ id: string; label: string }>).find((g) => g.id === id)?.label ?? id;
  const kind = current.doc.extensions["umf.visual"].kind;
  const base = `${def.id}-${current.id}`;

  const save = async (output: "svg" | "mermaid") => {
    setProblem(null);
    try {
      // A downloaded file can't read the page's CSS variables: draw it with the theme's values.
      const theme = themeAt(frame.current ?? document.body);
      const r = await render(current.doc, { theme, appearance: "light", output });
      if (output === "svg") download(`${base}.svg`, "image/svg+xml", r.content);
      // The access matrix has no Mermaid diagram; its portable form is a Markdown table.
      else if (kind === "comparison") download(`${base}.md`, "text/markdown", r.content || r.text);
      else download(`${base}.mmd`, "text/plain", r.content);
    } catch (e: any) {
      setProblem(e?.message ?? String(e));
    }
  };

  return (
    <Stack gap={4}>
      <p className="studio-meta">Read from the app's definition as it is now, so they change as the app changes.</p>
      <Cluster gap={3} align="end">
        <Select
          label="Diagram"
          value={current.id}
          options={diagrams.map((d) => ({ value: d.id, label: `${group(d.group)}: ${d.title}` }))}
          onChange={(e: any) => setChosen(e.target.value)}
          agent={{ id: "diagrams.choose", description: "Which diagram of the app is shown: its data model, states, flows and journeys, or access" }}
        />
        {current.id === "data-model" ? (
          <Switch label="Show derived values" checked={derived} onChange={(e: any) => setDerived(e.target.checked)}
            agent={{ id: "diagrams.derived", description: "Whether the data model shows derived (computed) values" }} />
        ) : null}
        <Switch label="Fit to width" checked={fit} onChange={(e: any) => setFit(e.target.checked)}
          agent={{ id: "diagrams.fit", description: "Whether the diagram is scaled to the panel's width, or shown at full size with scrolling" }} />
        <Button variant="secondary" onClick={() => save("svg")} agent={{ id: "diagrams.download-svg", description: "Download the shown diagram as an SVG image" }}>Download SVG</Button>
        <Button variant="secondary" onClick={() => save("mermaid")} agent={{ id: "diagrams.download-text", description: "Download the shown diagram as Mermaid (or a Markdown table for the access matrix)" }}>
          {kind === "comparison" ? "Download Markdown" : "Download Mermaid"}
        </Button>
      </Cluster>
      {problem ? <Notice tone="error" title="Could not download the diagram">{problem}</Notice> : null}
      <p>{current.description}</p>
      <div ref={frame} className="studio-diagram" data-fit={fit ? "" : undefined}>
        <Visual key={`${current.id}:${derived}:${view?.version}`} doc={current.doc} />
      </div>
    </Stack>
  );
}
