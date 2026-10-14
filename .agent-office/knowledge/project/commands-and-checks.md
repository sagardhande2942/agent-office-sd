---
title: "Commands to install, run, verify"
summary: "Verbatim npm commands for install, focused tests/profiling, final checks, and headless-browser Chromium discovery."
author: "worker:ab37cab0c171"
updated: "2026-10-14"
status: "active"
tags: []
human_verified_by: "human:inferno"
---
From the repository root:

```
npm install          # also builds client and server (prepare script)
npm run dev          # Vite on :5173 with hot reload, server on :4600 (password 123)
npm run typecheck    # tsc server + client projects, --noEmit
npm test             # node --import tsx --import=#tests/css --test tests/*.test.ts
npm run build        # build:client (vite build) then build:server (tsc -p tsconfig.server.json)
```

`npm run typecheck`, `npm test` and `npm run build` are the three checks required before a change is considered done. `npm test` uses the node test runner directly (no jest/vitest); a test file lives at `tests/<name>.test.ts` and helpers at `tests/support/`.

Other useful scripts in `package.json`:

```
npm run e2e:floor-host        # node --import tsx scripts/e2e-floor-host.mjs
npm run e2e:floor-ride        # node --import tsx scripts/e2e-floor-ride.mjs
npm run e2e:cinema            # node --import tsx scripts/e2e-cinema.mjs
npm run e2e:live-view-toggle  # browser check of the 2D/3D view toggle
npm run reel:record           # capture a demo reel
node --import tsx scripts/e2e-game2d.mjs
node --import tsx scripts/demo-floor-host.ts
```

Headless-browser harnesses under `scripts/e2e-*.mjs` launch Chromium from `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` unless `CHROMIUM_PATH` is set (`scripts/e2e-cinema.mjs:120`). They write screenshots and a `checks.json` to a temp artifacts directory (for example `/tmp/agent-office-game2d-evidence`, override with `GAME2D_ARTIFACTS`), which is the evidence to attach to a pull request that changes visuals.

The office itself is installed globally with `npm install -g .` and run as `npm start` (`node bin/agent-office.js`); `npm run dev` is the developer loop.
For fast iteration and profiling (include affected integration tests):

```sh
npm run test:focus -- tests/<affected>.test.ts
npm run test:focus -- --test-name-pattern='retention' tests/communications.test.ts
npm run test:profile:focus -- tests/client-structure.test.ts tests/client-registry.test.ts
npm run test:profile
```

Fresh worktrees can use `npm ci --ignore-scripts` followed by `npm run build` before integrations. Run the final full checks once the patch is ready; repeat successful checks only for new edits or unresolved concerns. See `project/testing-efficiently.md` and `docs/testing.md` for fixtures, known flakes and timing evidence.
