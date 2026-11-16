/* A value from the definition, rendered: text in its format, a status pill,
   an email link, multi-line text, or a link to another screen. */
import type { MouseEvent, ReactNode } from "react";
import { StatusPill } from "@ux-builder/ui";
import { hrefOf, useApp } from "./context";
import type { Location, Row } from "./contract";
import type { Navigate, Tone, ValueRef } from "./definition";
import { resolveNavigate, resolveValue, type ResolvedValue, type Runtime, type Scope } from "./runtime";

const PILL_STATES = new Set<Tone>(["live", "limited", "purchasing", "evaluation", "closed"]);

/** A status as the SDK's pill: one of its five states, or the plain pill for "neutral". */
export function Status({ tone, label }: { tone: Tone; label: string }) {
  return <StatusPill state={PILL_STATES.has(tone) ? tone : "neutral"}>{label}</StatusPill>;
}

/** A link to a screen inside the app; the renderer routes it, the browser never follows it. */
export function ScreenLink({ to, children }: { to: Location; children: ReactNode }) {
  const { navigate } = useApp();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a className="app-rt-link" href={hrefOf(to)} onClick={onClick}>{children}</a>;
}

export function renderResolved(v: ResolvedValue): ReactNode {
  let main: ReactNode = v.text;
  if (v.status) main = <Status tone={v.status.tone} label={v.status.label} />;
  else if (v.format === "email" && typeof v.raw === "string" && v.raw) main = <a className="app-rt-link" href={`mailto:${v.raw}`}>{v.text}</a>;
  else if (v.format === "multiline") main = <span className="app-rt-multiline">{v.text}</span>;
  if (!v.secondary) return main;
  return (
    <span className="app-rt-cell">
      <span className="app-rt-cell__main">{main}</span>
      <span className="app-rt-cell__secondary">{v.secondary}</span>
    </span>
  );
}

/** A value for a row, with its link when the value (or the region's row link, for the first column) names one. */
export function Cell({ rt, vr, row, scope, link }: { rt: Runtime; vr: ValueRef; row: Row; scope: Scope; link?: Navigate }) {
  const v = resolveValue(rt, vr, row, scope);
  const nav = vr.link ?? link;
  if (!nav) return <>{renderResolved(v)}</>;
  const to = resolveNavigate(nav, { ...scope, row });
  const link_ = <ScreenLink to={to}>{v.status ? v.status.label : v.text}</ScreenLink>;
  if (!v.secondary) return link_;
  // The link names the row; its second line (a note, a reason) sits under it.
  return (
    <span className="app-rt-cell">
      <span className="app-rt-cell__main">{link_}</span>
      <span className="app-rt-cell__secondary">{v.secondary}</span>
    </span>
  );
}
