/* One screen: its heading (title, description, back link, header actions)
   and its regions in order. The pattern is a hint; the regions decide what
   renders. A collection or form that opens the screen carries the heading
   itself, so the screen has exactly one level-1 heading. */
import { useMemo, type ReactNode } from "react";
import { Breadcrumbs, Button, Skeleton } from "@ux-builder/ui";
import { ErrorScreen, Page, PageHeader, Stack } from "@ux-builder/ui/patterns";
import { hrefOf, useApp } from "./context";
import type { Location } from "./contract";
import type { Placement, Screen } from "./definition";
import { ActionButton } from "./actions";
import { RegionView } from "./regions";
import { findRow, placementVisible, regionVisible, resolveNavigate, screenById, scopeWith, text, type Scope } from "./runtime";

export function ScreenView({ screen, param }: { screen: Screen; param?: string }) {
  const { rt, loading, navigate } = useApp();
  const paramRec = screen.param ? rt.idx.record(screen.param.record) : undefined;
  const row = paramRec ? findRow(rt, paramRec.id, param) : undefined;

  const scope: Scope = useMemo(() => {
    const params = screen.param && param != null ? { [screen.param.id]: param } : {};
    return scopeWith(rt, { record: row ?? null, row: row ?? null, params, param: params });
  }, [rt, row, screen.param, param]);

  const back: Location | undefined = screen.back ? resolveNavigate(screen.back, scope) : undefined;
  const backScreen = back ? screenById(rt, back.screen) : undefined;

  if (screen.param && !loading && !row) {
    return (
      <ErrorScreen kind="not-found" title={`This ${(paramRec?.title ?? "record").toLowerCase()} is not available`}
        actions={back ? <Button onClick={() => navigate(back)}>Back to {backTitle(rt, backScreen, back)}</Button> : undefined}>
        <p>It may have been removed, or you may not have access to it.</p>
      </ErrorScreen>
    );
  }
  // A screen-level condition (an extension some definitions carry) reads the screen's row as record.
  const when = (screen as Screen & { when?: Placement["when"] }).when;
  if (!loading && when && !regionVisible({ id: screen.id, kind: "notice", when }, rt, scope)) {
    return <ErrorScreen kind="not-found" title="This page is not available now" actions={back ? <Button onClick={() => navigate(back)}>Back</Button> : undefined} />;
  }

  const waitingForTitle = loading && typeof screen.title !== "string";
  const title: ReactNode = waitingForTitle ? <Skeleton width="12em" /> : text(screen.title, scope);
  const description = screen.description && !loading ? text(screen.description, scope) : undefined;
  const breadcrumbs = back && backScreen ? (
    <Breadcrumbs items={[{ label: backTitle(rt, backScreen, back), href: hrefOf(back), to: back }, { label: typeof title === "string" ? title : "" }]}
      onNavigate={(item: { to?: Location }) => item.to && navigate(item.to)} />
  ) : undefined;

  // Header actions: the primary action, and the rest beside it.
  const shown = loading ? [] : (screen.actions ?? []).filter((p) => placementVisible(rt, p, scope));
  const primary = shown.find((p) => p.emphasis === "primary") ?? null;
  const others = shown.filter((p) => p !== primary);
  const ctx = { scope, row, screenKey: param };
  const actions = primary ? <ActionButton placement={primary} ctx={ctx} variant="primary" /> : undefined;
  const secondary = others.length ? <>{others.map((p, i) => <ActionButton key={`${p.action}-${i}`} placement={p} ctx={ctx} variant={p.emphasis === "text" ? "text" : "secondary"} />)}</> : undefined;

  const regions = loading ? screen.regions ?? [] : (screen.regions ?? []).filter((r) => regionVisible(r, rt, scope));
  const first = regions[0];
  const hostsHeader = !!first && !description && first.kind === "collection";
  const formPage = regions.length === 1 && first?.kind === "form" && !shown.length;

  return (
    <Page width={formPage ? "form" : "page"}>
      <Stack gap={6}>
        {!hostsHeader && !formPage && (
          <PageHeader title={title} description={description} breadcrumbs={breadcrumbs} actions={actions} secondaryActions={secondary} />
        )}
        {regions.map((r, i) => (
          <RegionView key={r.id} region={r} scope={scope} screenKey={param} row={row} back={back}
            header={i === 0 && hostsHeader ? { title, breadcrumbs, actions, secondaryActions: secondary } : undefined}
            page={i === 0 && formPage ? { title: typeof title === "string" ? title : "", description, breadcrumbs } : undefined} />
        ))}
      </Stack>
    </Page>
  );
}

function backTitle(rt: ReturnType<typeof useApp>["rt"], s: Screen | undefined, to: Location): string {
  if (!s) return "Back";
  const rec = s.param ? rt.idx.record(s.param.record) : undefined;
  const row = rec ? findRow(rt, rec.id, to.param) : undefined;
  const params = s.param && to.param != null ? { [s.param.id]: to.param } : {};
  return text(s.title, scopeWith(rt, { record: row ?? null, row: row ?? null, params, param: params })) || "Back";
}
