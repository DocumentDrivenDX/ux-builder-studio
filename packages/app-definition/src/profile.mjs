/* App profile 0.1: the closed set of vocabularies and versions an engine that
   claims this profile renders and runs. A definition outside it is refused
   before UMF validation even starts, so nothing is half-supported. */

export const APP_PROFILE = Object.freeze({
  id: "ux-builder.app-profile",
  version: "0.1.0",
  core: "0.10.0",
  required: { "umf.app": "0.1.0", "umf.ux": "0.1.0", "umf.actions": "0.1.0" },
  optional: { "umf.dashboard": "0.1.0", "umf.ddd": "0.1.0", "umf.tables": "0.1.0" },
  expression: { language: "umf.app.expr", version: "1" },
  /* UMF diagnostics an app definition may carry and still render: each is a
     declaration UMF keeps but leaves to a separately qualified executor,
     which in this profile is the studio runtime. */
  acceptedIncomplete: Object.freeze({
    ACTION_UNCHECKED: "umf.actions authorization and attribution profiles are interpreted by the studio runtime (role authorization against umf.app roles)",
  }),
});

const list = (v) => (Array.isArray(v) ? v : []);

/* Returns diagnostics in UMF's shape ({code, path, message, severity}). */
export function checkProfile(doc) {
  const out = [];
  const add = (code, path, message) => out.push({ code, path, message, severity: "error" });
  if (doc?.umf !== APP_PROFILE.core) add("PROFILE_CORE", "/umf", `App profile ${APP_PROFILE.version} needs UMF core ${APP_PROFILE.core}, found ${doc?.umf}`);
  const vocab = doc?.vocabularies ?? {};
  for (const [id, version] of Object.entries(APP_PROFILE.required)) {
    if (vocab[id]?.version !== version) add("PROFILE_VOCABULARY", `/vocabularies/${id}`, `App profile ${APP_PROFILE.version} needs ${id} ${version}`);
  }
  for (const [id, entry] of Object.entries(vocab)) {
    const allowed = APP_PROFILE.required[id] ?? APP_PROFILE.optional[id];
    if (!allowed) add("PROFILE_VOCABULARY", `/vocabularies/${id}`, `${id} is not part of app profile ${APP_PROFILE.version}`);
    else if (entry?.version !== allowed) add("PROFILE_VOCABULARY", `/vocabularies/${id}`, `App profile ${APP_PROFILE.version} supports ${id} ${allowed}, not ${entry?.version}`);
  }
  if (list(doc?.modules).length === 0) add("PROFILE_MODULES", "/modules", "An app definition needs at least one module of records");
  return out;
}

/* Combine a UMF validation with the profile check into the studio's verdict:
   renderable when valid and every incompleteness is accepted by the profile. */
export function verdict(umfValidation, profileDiagnostics = []) {
  const diagnostics = [...profileDiagnostics, ...list(umfValidation?.diagnostics)];
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity !== "error");
  const unaccepted = warnings.filter((d) => !APP_PROFILE.acceptedIncomplete[d.code]);
  return {
    valid: errors.length === 0 && umfValidation?.valid !== false,
    complete: !!umfValidation?.complete,
    /* Renderable when nothing is an error. Warnings are findings to fix (shown in the
       studio's rules panel); UMF incompleteness the profile accepts is not a finding. */
    renderable: errors.length === 0 && umfValidation?.valid !== false,
    errors,
    warnings,
    unaccepted,
    diagnostics,
  };
}
