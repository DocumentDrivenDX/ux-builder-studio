/* Running umf.actions actions from their placements: the button or menu item,
   the questions (a QuickEdit of inputs), the confirmation before anything
   destructive, the run itself, and what follows it (a toast, navigation, a
   fresh snapshot). One host per app holds the open dialog, so a row's menu,
   a header button and a schedule event all ask the same way. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, ChoicePicker, DatePicker, Notice, Select, Switch, TextArea, TextField, useToast } from "@ux-builder/ui";
import { ConfirmDialog, QuickEdit, useFormState } from "@ux-builder/ui/patterns";
import { mayRun } from "./engine";
import { useApp } from "./context";
import type { ActionResult, Json } from "./contract";
import type { Placement } from "./definition";
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
  isDestructive,
  placementVisible,
  resolveNavigate,
  text,
  validateInputs,
  type ActionContext,
  type InputSpec,
  type Scope,
} from "./runtime";

type Failure = { message: string; field?: string; value?: unknown };

interface ActionsValue {
  /** Offer an action: ask for inputs or confirmation as the placement says, then run it. Resolves once it has run, or once a dialog has opened. */
  request(p: Placement, ctx: ActionContext): Promise<void>;
}

const ActionsContext = createContext<ActionsValue | null>(null);

export function useActions(): ActionsValue {
  const v = useContext(ActionsContext);
  if (!v) throw new Error("app-runtime: useActions() outside the action host");
  return v;
}

interface Open {
  id: number;
  placement: Placement;
  ctx: ActionContext;
  stage: "inputs" | "confirm";
  inputs: InputSpec[];
  open: boolean;
}

export function ActionHost({ children }: { children: ReactNode }) {
  const app = useApp();
  const { rt } = app;
  const toast = useToast();
  const [current, setCurrent] = useState<Open | null>(null);
  const seq = useRef(0);
  const appRef = useRef(app);
  appRef.current = app;

  /* Run with the bound parameters plus input values. Returns the failure to show, or null on success. */
  const run = useCallback(async (p: Placement, ctx: ActionContext, inputs: InputSpec[], values: Record<string, unknown>): Promise<Failure | null> => {
    const { rt, client, emit, reload, navigate } = appRef.current;
    const a = actionOf(rt, p.action);
    // The host enforces authorization again; the renderer never even asks for an action the person may not run.
    if (!a || !mayRun(rt.idx, p.action, rt.identity)) return { message: `${rt.identity.name} may not ${(a?.name ?? p.action).toLowerCase()}` };
    const { params: bound, perSelection } = boundParams(rt, p, ctx);
    const params: Record<string, Json> = { ...bound, ...inputParams(inputs, values) };
    const keys = perSelection ? (ctx.selection ?? []) : [null];
    let last: ActionResult | null = null;
    let done = 0;
    for (const key of keys) {
      const sent = key == null ? params : { ...params, [perSelection!]: key };
      let result: ActionResult;
      try {
        result = await client.run(p.action, sent);
      } catch (e) {
        result = { ok: false, code: "CLIENT", message: e instanceof Error ? e.message : "The action could not be sent. Try again." };
      }
      emit({ type: "action", action: p.action, params: sent, result });
      last = result;
      if (!result.ok) break;
      done++;
    }
    if (!last) return null;
    if (!last.ok) {
      if (done > 0) await reload();
      const field = failureField(rt, p.action, last, inputs);
      const prefix = perSelection && done > 0 ? `${done} of ${keys.length} done. ` : "";
      return { message: prefix + last.message, field, value: field ? values[field] : undefined };
    }
    // After a create, the new row's key is known: success text and navigation can use it as params.<key>.
    const created = last.created?.key;
    const keyParam = created ? createKeyParam(rt, a) : undefined;
    const runParams = { ...params, ...(keyParam && created ? { [keyParam.id]: created } : {}) };
    const scope: Scope = { ...ctx.scope, row: ctx.row ?? ctx.scope.row, selection: ctx.selection, input: values, params: runParams, param: runParams };
    const message = p.success?.toast ? text(p.success.toast, scope) : last.message ?? (perSelection ? `${done} ${done === 1 ? "item" : "items"} updated` : defaultSuccess(rt, p.action));
    toast.show({ message: message || defaultSuccess(rt, p.action) });
    ctx.onDone?.();
    await reload();
    if (p.success?.navigate) navigate(resolveNavigate(p.success.navigate, scope));
    return null;
  }, [toast]);

  const request = useCallback(async (p: Placement, ctx: ActionContext) => {
    const { rt } = appRef.current;
    if (!placementVisible(rt, p, ctx.scope)) return;
    const inputs = actionInputs(rt, p);
    if (inputs.length || p.confirm || isDestructive(rt, p)) {
      setCurrent({ id: ++seq.current, placement: p, ctx, inputs, stage: inputs.length ? "inputs" : "confirm", open: true });
      return;
    }
    const failure = await run(p, ctx, [], {});
    if (failure) toast.show({ message: failure.message });
  }, [run, toast]);

  const close = useCallback(() => setCurrent((c) => (c ? { ...c, open: false } : c)), []);
  const value = useMemo(() => ({ request }), [request]);

  let dialog: ReactNode = null;
  if (current) {
    const { placement: p, ctx } = current;
    const scope: Scope = { ...ctx.scope, row: ctx.row ?? ctx.scope.row, selection: ctx.selection };
    const label = actionLabel(rt, p);
    const confirmTitle = p.confirm ? text(p.confirm.title, scope) : undefined;
    const confirmMessage = p.confirm?.message ? text(p.confirm.message, scope) : undefined;
    if (current.stage === "inputs") {
      dialog = (
        <InputsDialog key={current.id} open={current.open} title={confirmTitle || label} submitLabel={p.confirm?.confirmLabel ?? label}
          warning={confirmTitle ? confirmMessage : undefined} destructive={isDestructive(rt, p)} inputs={current.inputs} scope={scope}
          onSubmit={(values) => run(p, ctx, current.inputs, values)} onClose={close} />
      );
    } else {
      dialog = (
        <ConfirmDialog key={current.id} open={current.open} title={confirmTitle || `${label}?`} consequence={confirmMessage}
          confirmLabel={p.confirm?.confirmLabel ?? label} onCancel={close}
          onConfirm={async () => { close(); const failure = await run(p, ctx, [], {}); if (failure) toast.show({ message: failure.message }); }} />
      );
    }
  }

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {dialog}
    </ActionsContext.Provider>
  );
}

/* ---------- the dialog of inputs ---------- */

function InputsDialog({ open, title, submitLabel, warning, destructive, inputs, scope, onSubmit, onClose }: {
  open: boolean;
  title: string;
  submitLabel: string;
  warning?: string;
  destructive: boolean;
  inputs: InputSpec[];
  scope: Scope;
  onSubmit(values: Record<string, unknown>): Promise<Failure | null>;
  onClose(): void;
}) {
  const [failure, setFailure] = useState<Failure | null>(null);
  // QuickEdit closes itself after a submit that passed validation; a failed run keeps it open.
  const keepOpen = useRef(false);
  const initial = useMemo(() => initialValues(inputs, scope), []); // eslint-disable-line react-hooks/exhaustive-deps
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
      const f = await onSubmit(values);
      if (f) {
        keepOpen.current = true;
        setFailure(f);
      }
    },
  });
  const general = failure && !failure.field ? failure.message : null;
  return (
    <QuickEdit open={open} title={title} form={form} submitLabel={submitLabel}
      onClose={() => { if (keepOpen.current) { keepOpen.current = false; return; } onClose(); }}>
      {warning && <Notice tone={destructive ? "warning" : "info"} title={warning} />}
      {general && <Notice tone="error" title={general} role="alert" />}
      {inputs.map((s) => <InputControl key={s.id} spec={s} form={form} scope={scope} />)}
    </QuickEdit>
  );
}

/* ---------- one input ---------- */

type Form = ReturnType<typeof useFormState>;

export function InputControl({ spec, form, scope }: { spec: InputSpec; form: Form; scope: Scope }) {
  const f = form.field(spec.id);
  const label = spec.required || spec.control === "checkbox" || spec.control === "switch" ? spec.label : `${spec.label} (optional)`;
  const options = spec.options?.(scope) ?? [];
  switch (spec.control) {
    case "textarea":
      return <TextArea label={label} hint={spec.hint} {...f} />;
    case "select":
      return <Select label={label} hint={spec.hint} options={options} placeholder={`Choose ${spec.label.toLowerCase()}`} {...f} />;
    case "choice":
      // ChoicePicker shows no error of its own: the error summary lists it, and a hint repeats it beside the control.
      return (
        <div className="app-rt-choice">
          <ChoicePicker label={label} options={options} value={f.value} onChange={f.onChange} />
          {f.error ? <p className="app-rt-choice__error" id={`${f.id}-error`}>{f.error}</p> : spec.hint ? <p className="app-rt-choice__hint">{spec.hint}</p> : null}
        </div>
      );
    case "checkbox":
      return <Checkbox label={label} name={f.name} checked={!!form.values[spec.id]} onChange={f.onChange} />;
    case "switch":
      return <Switch label={label} name={f.name} checked={!!form.values[spec.id]} onChange={f.onChange} />;
    case "date":
      return <DatePicker label={label} hint={spec.hint} id={f.id} value={f.value} onChange={f.onChange} error={f.error} />;
    case "time":
      return <TextField label={label} hint={spec.hint} type="time" {...f} />;
    case "datetime":
      return <TextField label={label} hint={spec.hint} type="datetime-local" {...f} />;
    case "number":
      return <TextField label={label} hint={spec.hint} inputMode={spec.integer ? "numeric" : "decimal"} {...f} />;
    case "currency":
      return <TextField label={label} hint={spec.hint ?? "In US dollars"} inputMode="decimal" {...f} />;
    case "hours":
      return <TextField label={label} hint={spec.hint ?? "In hours, for example 1.5"} inputMode="decimal" {...f} />;
    case "email":
      return <TextField label={label} hint={spec.hint} type="email" autoComplete="email" {...f} />;
    case "file":
      return <TextField label={label} hint={spec.hint ?? "A link to the file"} type="url" {...f} />;
    default:
      return <TextField label={label} hint={spec.hint} {...f} />;
  }
}

/* ---------- buttons ---------- */

const VARIANT = { primary: "primary", secondary: "secondary", text: "text", destructive: "secondary" } as const;

/** A placement as a button; renders nothing when the person may not use it here. */
export function ActionButton({ placement, ctx, variant }: { placement: Placement; ctx: ActionContext; variant?: "primary" | "secondary" | "text" }) {
  const { rt } = useApp();
  const { request } = useActions();
  const [busy, setBusy] = useState(false);
  if (!placementVisible(rt, placement, ctx.scope)) return null;
  const v = variant ?? VARIANT[placement.emphasis ?? "secondary"];
  return (
    <Button variant={v} busy={busy} onClick={async () => { setBusy(true); try { await request(placement, ctx); } finally { setBusy(false); } }}>
      {actionLabel(rt, placement)}
    </Button>
  );
}

/** Placements as MenuButton items, for a row or an event. */
export function useActionItems() {
  const { rt } = useApp();
  const { request } = useActions();
  return useCallback((placements: Placement[] | undefined, ctx: ActionContext) =>
    (placements ?? []).filter((p) => placementVisible(rt, p, ctx.scope)).map((p) => ({ label: actionLabel(rt, p), onSelect: () => { void request(p, ctx); } })),
  [rt, request]);
}
