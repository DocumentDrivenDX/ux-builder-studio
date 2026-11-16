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
npm run dev                                      # http://localhost:5173
```

Without a model key the App Expert is a scripted builder that replays one
recorded build (a time tracker), which is what the tests use.

## What's here

| Path | What |
|---|---|
| `apps/studio` | The studio: server (UMF, Postgres, Redis, the App Expert) and UI |
| `packages/app-definition` | The `umf.app` and `umf.ux` vocabularies, app profile 0.1, the expression language, the engine, the typed operations, and the diagrams read from a definition |
| `packages/app-runtime` | Renders a definition with ux-builder widgets and patterns only |
| `vendor/ux-builder` | ux-builder, as a submodule pinned to a commit |
| `patches/` | Changes to ux-builder the studio needs that are not upstream yet; `npm run setup` applies them |

## ux-builder as a submodule

The studio builds on parts of ux-builder that are not published to npm (the
palette engine and the UX rules catalog), so it uses the repository itself,
pinned to a commit. To move to a newer ux-builder:

```sh
git -C vendor/ux-builder fetch && git -C vendor/ux-builder checkout <commit>
npm install && npm run setup && npm run check
git add vendor/ux-builder && git commit
```

When a patch in `patches/` lands upstream, delete it in the same commit that
moves the submodule past it.

## Checks

```sh
npm run check        # typecheck, unit and integration tests, OUI manifest
npm run e2e          # the user test, with Playwright and the scripted App Expert
```

## Licence

MIT or Apache-2.0, at your option.
