---
title: "Lore Shelf validation commands"
summary: "Needs verification: worker-reported Lore Shelf checks, with build and typecheck definitions supported by package.json."
sources: ["handovers/6ccaea9a0f64-0.md"]
status: "needs-verification"
author: "curator"
updated: "2026-10-13"
---
---
status: needs-verification
---
# Lore Shelf validation commands

Source: handovers/6ccaea9a0f64-0.md, reporting PR #126 and commit d25512d. Successful runs are historical worker claims and remain unverified against supplied repository evidence at f236760c7ed697841394157ab7fed67de913fa73.

## Commands and rationale

- `npm run typecheck` — checks client and server TypeScript. Supplied package.json defines both checks with `--noEmit`.
- `node --import tsx --test tests/lore.test.ts` — reported feature unit tests.
- `node --import tsx --import=#tests/css --test tests/size.test.ts` — reported source-size check enforcing a 600-line limit.
- `node --import tsx --import=#tests/css --test tests/client-structure.test.ts` and `node --import tsx --import=#tests/css --test tests/client-registry.test.ts` — reported client structure and registry checks.
- `npm run build` — package.json confirms a Vite client build followed by a TypeScript server build.

The handover also reports a headless browser run of `scripts/e2e-lore-shelf.mjs` and screenshot output at `docs/lore-shelf-evidence/lore-shelf.png`; no invocation was supplied.

package.json confirms the `#tests/css` import mapping and use of tsx in the general test command. It does not establish the specific test files, size limit, browser script, screenshot, implementation, or successful outcomes. Those claims require verification before reuse as current repository facts.
