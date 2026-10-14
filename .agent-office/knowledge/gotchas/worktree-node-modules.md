---
summary: "Fresh worktrees need dependencies; isolated npm ci or a compatible dependency symlink works. Build dist/public before server integration tests."
title: "Prepare worktree dependencies and build before integration tests"
author: "agent:codex"
updated: "2026-10-14"
status: "active"
tags: ["testing","worktrees","dependencies"]
paths: ["package.json","package-lock.json","tests/**"]
sources: ["package.json","package-lock.json","tests/communications-server.test.ts","tests/completion-server.test.ts","tests/manager-server.test.ts","docs/code-layout.md"]
verified_at: "3679129"
---
# A worktree does not inherit dependencies or artifacts

A fresh worktree is a checkout with no node_modules or dist/public. From its root, prepare independently:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

This installs the checked-in lockfile without the package's prepare hook, then explicitly builds and tests. npm install is another supported path and runs prepare (the build) automatically, but npm ci is useful for validating the committed lockfile without modifying it.

A deliberately shared, compatible node_modules symlink is an alternative, not a requirement. Point it at the actual dependency installation and check that the worktree's lockfile/dependency versions match. If the lockfile changes, use an isolated installation; do not mutate another live session's shared dependencies to satisfy this worktree.

Typecheck does not require a client build, but several real-server tests require dist/public and fail with “Client bundle not found” until built. Build before the full suite and server/browser integration checks.

Verification on base 3679129: an isolated npm ci --ignore-scripts succeeded; typecheck and build passed; the full suite reported 1,368 passed, zero failed and one skipped. These results describe that run, not a guarantee on every platform.

When one full-suite test fails, capture its error and rerun that file with the same loaders:

```sh
node --import tsx --import=#tests/css --test tests/cabinet.test.ts
```

A passing isolated rerun suggests timing or environmental interference but does not prove the original failure was harmless. Check the exact test on the unchanged base and investigate machine load or live-office probes where relevant; retain the failed result in delivery evidence. See gotchas/live-office-probes-test-servers.md and project/test-selection.md.
