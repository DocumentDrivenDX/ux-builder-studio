# UX Builder Studio

Build business apps by talking to an expert. The **App Expert** asks what the
app is for, builds it in front of you, and keeps working with you as you come
back to add features. Every app is a **UMF definition**, not code: records,
relationships, access rules, actions, screens and navigation. ux-builder's
widgets render it, and its data lives in PostgreSQL tables that UMF deploys.
Everything runs on your machine; only the AI model is remote.

It builds on three open-source projects:

- [UMF](https://github.com/DocumentDrivenDX/umf), the schema fabric. The studio
  registers two vocabularies through UMF's extension API (`umf.app` 0.1 for
  roles, derived values, access and samples; `umf.ux` 0.1 for screens and
  navigation) and uses UMF to validate every change and deploy the tables.
- [ux-builder](https://github.com/DocumentDrivenDX/ux-builder): the tokens,
  themes, widgets, patterns, diagrams, palette engine and UX rules.
- OUI (`@ouispec/*`): the agent operates the studio's own controls and rooms,
  the way a person does.

## Run it

Needs Node 22, git and `redis-server` on PATH (`brew install redis`).

```sh
git clone --recursive https://github.com/DocumentDrivenDX/ux-builder-studio.git
cd ux-builder-studio
npm ci
npm run setup                                    # patches and builds ux-builder, fetches UMF's SDK
cp apps/studio/.env.example apps/studio/.env     # add ANTHROPIC_API_KEY (or OPENAI_API_KEY)
npm run dev                                      # http://localhost:5173, then sign in
```

Without a model key the App Expert is a scripted builder that replays one
recorded build (a time tracker), which is what the tests use.

## Signing in, and apps on the organisation's data

People sign in as themselves, and can build three kinds of app:

- **Reporting** on tables in the organisation's data catalog: dashboards,
  charts and lists, read only.
- **Data management**: look up, add and correct rows in catalog tables.
- **Its own data**: a data model the App Expert designs, with sample data.

Rows in the first two are read and changed **as whoever uses the app**, with
their own token, so the catalog's grants, row filters and column masks always
apply. An app can narrow what the catalog shows, never widen it. Apps are
private to their owner until shared with people or groups.

By default everything runs on this machine, against a made-up law firm,
Harbor & Vale LLP:

- **Sign-in** through its own OpenID Connect provider (port 8790). You choose
  one of five people, each in different groups.
- **Data catalog**: a Unity Catalog stand-in (port 8791) that answers Unity
  Catalog's REST API and SQL Statement Execution API. Its people are
  PostgreSQL roles, its grants are PostgreSQL grants, its row filters are
  row-level security, and its masks are applied by a view.

| Person | Groups | What the catalog lets them do |
|---|---|---|
| Alex Morgan, managing partner | partners, studio-builders | Every matter; finance; may change matters |
| Priya Shah, litigation associate | litigation, studio-builders | Litigation matters and their time only; budgets masked |
| Sam Okafor, finance operations | finance, data-stewards, studio-builders | Every matter; finance; may change invoices and clients |
| Jordan Lee, head of people | hr, studio-builders | Employees, with pay; may change them |
| Casey Brooks, corporate paralegal | corporate | Not a builder: uses the apps shared with them |

To use the organisation's own systems instead:

| Setting | What |
|---|---|
| `STUDIO_AUTH=oidc` with `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The organisation's identity provider. `OIDC_GROUPS_CLAIM` names the claim with a person's groups (default `groups`); `STUDIO_BUILDER_GROUPS` names the groups that may build (default `studio-builders`) |
| `STUDIO_CATALOG=unity` with `DATABRICKS_HOST`, `DATABRICKS_WAREHOUSE_ID` | A Databricks workspace's Unity Catalog, read with the token from the person's sign-in, so the workspace must be the sign-in's issuer, or accept its tokens. Not yet tried against a live workspace |
| `STUDIO_AUTH=none` | No sign-in and no catalog: one local owner, building apps on their own data |
| `STUDIO_PUBLIC_URL` | The address people open the studio at (default `http://localhost:5173`); sign-in returns there |

## What's here

| Path | What |
|---|---|
| `apps/studio` | The studio: server (UMF, Postgres, Redis, the App Expert) and UI |
| `packages/app-definition` | The `umf.app` and `umf.ux` vocabularies, app profile 0.1, the expression language, the engine, the typed operations, and the diagrams read from a definition |
| `packages/app-runtime` | Renders a definition with ux-builder widgets and patterns only |
| `vendor/ux-builder` | ux-builder, as a submodule pinned to a commit |
| `patches/` | ux-builder's open pull requests and the studio's own change to it, not merged yet; `npm run setup` applies them |

## ux-builder as a submodule

The studio builds on parts of ux-builder that are not published to npm (the
palette engine, the theme checks and the UX rules catalog), so it uses the
repository itself: `vendor/ux-builder`, pinned to ux-builder's `main`.
`npm run setup` applies the files in `patches/` to it, in order:

| Patch | What |
|---|---|
| `01-ux-builder-prs-80-81-82.patch` | ux-builder's open PRs #80 (the original themes restored beside the vk- themes), #81 (theme checks: ten theme and colour rules measured on every theme) and #82 (blue accents on the original themes) |
| `02-ux-builder-pr-83.patch` | ux-builder's open PR #83 (e2e cold-start fix, licence records) |
| `03-ux-builder-ui-replying-phrases.patch` | The studio's change to ux-builder's Conversation: rotating "replying" phrases |

To move to a newer ux-builder:

```sh
git -C vendor/ux-builder fetch && git -C vendor/ux-builder checkout <commit>
npm install && npm run setup && npm run check
git add vendor/ux-builder && git commit
```

When a patch lands upstream, delete it in the same commit that moves the
submodule past it.

## Checks

```sh
npm run check        # typecheck, unit and integration tests, OUI manifest
npm run e2e          # the user test, with Playwright and the scripted App Expert
```

## Licence

MIT or Apache-2.0, at your option.
