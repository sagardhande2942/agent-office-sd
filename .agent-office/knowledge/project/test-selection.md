---
title: "Select meaningful checks and browser fixtures for a change"
summary: "Build before integration tests, use focused test files for diagnosis, and choose the feature-specific E2E without claiming fixtures prove live providers."
tags: ["testing","ci","browser"]
paths: ["tests/**","scripts/e2e-*.mjs","package.json"]
sources: ["AGENTS.md","package.json","docs/code-layout.md","docs/knowledge.md","scripts/e2e-task-brief.mjs","scripts/e2e-worker-roles.mjs","scripts/e2e-boss-mode.mjs"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Prepare the isolated worktree

A fresh worktree has neither dependencies nor build artifacts. From its root:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

package.json requires Node >=20. The full suite uses the Node test runner with tsx and the CSS loader, not Jest/Vitest. Build before server integration tests: they start the real server and require dist/public. An existing compatible node_modules symlink is an alternative when deliberately sharing dependencies; do not assume it matches a changed lockfile.

## Select checks by the boundary changed

| Change | Focused coverage and harness |
| --- | --- |
| Client registration/import graph | tests/client-structure.test.ts, tests/client-registry.test.ts, tests/size.test.ts |
| Server dispatch | tests/server-dispatch.test.ts plus the domain's tests |
| Knowledge format/store/review | tests/knowledge.test.ts, tests/knowledge-tools.test.ts; scripts/e2e-knowledge-tree.mjs |
| Knowledge publication or sync | tests/knowledge-delivery.test.ts, tests/knowledge-auto-sync.test.ts, tests/knowledge-curator-plan.test.ts; scripts/e2e-knowledge-curator.mjs |
| Knowledge shelf UI | scripts/e2e-knowledge-shelf.mjs |
| Shared 2D/3D game behavior | scripts/e2e-game2d.mjs |
| Task brief drafts | tests/task-brief.test.ts, tests/task-brief-ai.test.ts, tests/task-brief-routes.test.ts; scripts/e2e-task-brief.mjs |
| Worker roles | tests/worker-roles.test.ts; scripts/e2e-worker-roles.mjs |
| Inbox/receipts | tests/communications.test.ts, tests/communications-server.test.ts, tests/communications-state.test.ts, tests/communication-checkpoints.test.ts |
| Hosted floors/retry | tests/floorhost.test.ts, tests/floorhost-conn.test.ts, tests/floor-host-retry.test.ts; scripts/e2e-floor-host.mjs |
| Boss lifecycle/remote readiness | tests/boss-mode.test.ts, tests/boss-mode-remote.test.ts, tests/boss-connection.test.ts; scripts/e2e-boss-mode.mjs, scripts/e2e-boss-connection.mjs |

Focused diagnosis example:

```sh
node --import tsx --import=#tests/css --test tests/knowledge-delivery.test.ts
node --import tsx scripts/e2e-knowledge-tree.mjs
```

The project still requires the full typecheck, test and build checks for delivery. Focused passes explain a failure; they do not erase a failed full-suite result.

## Browser evidence

Use the specific script's Chromium lookup rules; they differ. Set CHROMIUM_PATH to an installed executable when needed. Visual changes require a headless screenshot; interaction changes also require assertions for the behavior. Put artifacts outside tracked docs unless intentionally committing evidence. Examples: KNOWLEDGE_ARTIFACTS, GAME2D_ARTIFACTS, TASK_BRIEF_ARTIFACTS, BOSS_ARTIFACTS; worker-roles uses OUT.

A missing shared library is a browser-launch failure, not an application assertion failure. Diagnose the launch error using gotchas/headless-chromium-libs.md. Fixture agents and mocked forge publishing prove the integration exercised by the harness; they do not prove a paid provider login or an external PR publication succeeded.

Record command, exit result, counts, explicit skips and relevant artifact paths. Do not run paid model turns just to verify a docs change.
