# UX Builder Studio

Describe an app in plain language; an agent builds it in front of you. The app
is a **UMF document**, not code: records and fields (UMF core), actions
(`umf.actions`), and two new vocabularies registered through UMF's public
extension API:

- `umf.app` 0.1: roles, derived values, row access, foreign keys, samples, catalog identity;
- `umf.ux` 0.1: look, shell, navigation and pattern-based screens.

`@ux-builder/app-runtime` renders that definition with `@ux-builder/ui` widgets
and patterns only. Its data lives in PostgreSQL tables that UMF's own table
compiler deploys. The agent is OUI (`@ouispec/*`): it operates the studio's own
controls and rooms, the same way a person does. Everything runs on this
machine.

## Run it

```sh
npm ci                                            # at the repository root, once
npm run setup                                     # patches and builds ux-builder, fetches UMF's SDK (checksum-verified), once
cp apps/studio/.env.example apps/studio/.env      # optional: add ANTHROPIC_API_KEY or OPENAI_API_KEY
npm run dev                                       # http://localhost:5173
```

Needs Node 22 and `redis-server` on PATH (`brew install redis`). The studio
starts Redis itself when nothing listens on 6379.

Without a model key, the assistant is the **scripted builder**. It replays the
recorded time-tracker build (`fixtures/time-tracker.build.mjs`) through the real
agent worker, OUI tab runtime, rooms, UMF validation and preview, so it only
builds that one app. With a key, any request works.

Database: embedded PGlite (PostgreSQL 18.6) in `.data/pg` by default. To use a
real Postgres instead, run `docker compose up -d` and set `DATABASE_URL`.

## Where things are

| Path | What |
|---|---|
| `packages/app-definition` | The vocabularies (`vocabularies/`), their semantic validators, app profile 0.1, the `umf.app.expr` expression language, the engine (derived values, access, `umf.actions` execution), and the typed operations the agent builds with |
| `packages/app-runtime` | The renderer, including the new `WeekSchedule` time grid |
| `apps/studio/server` | UMF (validation, table deployment), Postgres, the app store with versions and variants, the API, and the agent (OUI realtime and worker, knowledge, scripted model) |
| `apps/studio/src` | The studio UI. OUI bindings come from `oui/ux-builder-ui.mapping.json`; rooms are in `src/rooms` |
| `apps/studio/fixtures` | The time tracker: recorded build and sample data, generated from time-tracker-2's seed |

## Checks

```sh
npm test --workspace @ux-builder/studio            # engine + time tracker against UMF and Postgres
npm run typecheck --workspace @ux-builder/studio
npm run oui:check --workspace @ux-builder/studio   # OUI's generated manifest is current
npm run e2e --workspace @ux-builder/studio         # the user test, with Playwright (results in _scratch/studio-user-test/)
```
