/* A form region: the inputs of one action, on the page. As a screen's first
   and only content it is a FormPage (it then carries the screen's heading);
   elsewhere it is a section of fields with its own submit button. */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button, Notice, useToast } from "@ux-builder/ui";
import { ErrorSummary, FormPage, FormSection, useFormState } from "@ux-builder/ui/patterns";
import { mayRun } from "../engine";
import { useApp } from "../context";
import type { Json, Location } from "../contract";
import type { Region } from "../definition";
import { InputControl } from "../actions";
import {
  actionInputs,
  actionLabel,
  actionOf,
  boundParams,
  createKeyParam,
  defaultSuccess,
  failureField,
  initialValues,
  inputParams,
  resolveNavigate,
  text,
  validateInputs,
  type Scope,
} from "../runtime";

type Failure = { message: string; field?: string; value?: unknown };

interface FormRegionProps {
  region: Region;
  scope: Scope;
  screenKey?: string;
  /** As the screen's page: its title, description and breadcrumbs. */
  page?: { title: string; description?: string; breadcrumbs?: ReactNode };
  back?: Location;
}

export function FormRegion(props: FormRegionProps) {
  // A fresh form after each successful submit that stays on the screen.
  const [generation, setGeneration] = useState(0);
  return <FormBody key={generation} {...props} onFresh={() => setGeneration((g) => g + 1)} />;
}

function FormBody({ region, scope, screenKey, page, back, onFresh }: FormRegionProps & { onFresh(): void }) {
  const { rt, client, emit, reload, navigate } = useApp();
  const toast = useToast();
  const action = region.action ? actionOf(rt, region.action) : undefined;
  const placement = useMemo(() => ({ action: region.action ?? "", bind: region.bind, inputs: region.inputs, success: region.success }), [region]);
  const inputs = useMemo(() => actionInputs(rt, placement), [rt, placement]);
  const initial = useMemo(() => initialValues(inputs, scope), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [failure, setFailure] = useState<Failure | null>(null);
  const validate = useCallback((v: Record<string, unknown>) => {
    const errors = validateInputs(inputs, v);
    if (failure?.field && v[failure.field] === failure.value && !errors[failure.field]) errors[failure.field] = failure.message;
    return errors;
  }, [inputs, failure]);

  const form = useFormState({
    initial,
    validate,
    onSubmit: async (values: Record<string, unknown>) => {
      setFailure(null);
      if (!action) return;
      const { params: bound } = boundParams(rt, placement, { scope, screenKey });
      const params: Record<string, Json> = { ...bound, ...inputParams(inputs, values) };
      let result;
      try {
        result = await client.run(action.id, params);
      } catch (e) {
        result = { ok: false as const, code: "CLIENT", message: e instanceof Error ? e.message : "The form could not be sent. Try again." };
      }
      emit({ type: "action", action: action.id, params, result });
      if (!result.ok) {
        const field = failureField(rt, action.id, result, inputs);
        setFailure({ message: result.message, field, value: field ? values[field] : undefined });
        return;
      }
      const key = createKeyParam(rt, action);
      const runParams = { ...params, ...(key && result.created ? { [key.id]: result.created.key } : {}) };
      const s: Scope = { ...scope, input: values, params: runParams, param: runParams };
      toast.show({ message: (region.success?.toast ? text(region.success.toast, s) : "") || result.message || defaultSuccess(rt, action.id) });
      await reload();
      if (region.success?.navigate) navigate(resolveNavigate(region.success.navigate, s));
      else onFresh();
    },
  });

  if (!action || !mayRun(rt.idx, action.id, rt.identity)) {
    return <Notice tone="info" title="This form is not available to you" />;
  }
  const general = failure && !failure.field ? <Notice tone="error" title={failure.message} role="alert" /> : null;
  const fields = inputs.map((s) => <InputControl key={s.id} spec={s} form={form} scope={scope} />);
  const submitLabel = region.submitLabel ?? actionLabel(rt, placement);

  if (page) {
    return (
      <FormPage title={page.title} description={page.description} breadcrumbs={page.breadcrumbs} form={form} submitLabel={submitLabel}
        onCancel={back ? () => navigate(back) : undefined}>
        {general}
        <FormSection title={region.title ? text(region.title, scope) : action.name} description={region.description ? text(region.description, scope) : undefined}>
          {fields}
        </FormSection>
      </FormPage>
    );
  }
  return (
    <form className="app-rt-form" noValidate onSubmit={form.submit}>
      <ErrorSummary errors={form.shownErrors} idOf={form.idOf} attempt={form.attempt} />
      {general}
      <FormSection title={region.title ? text(region.title, scope) : action.name} description={region.description ? text(region.description, scope) : undefined}>
        {fields}
      </FormSection>
      <div className="app-rt-form__actions">
        <Button type="submit" busy={form.busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
