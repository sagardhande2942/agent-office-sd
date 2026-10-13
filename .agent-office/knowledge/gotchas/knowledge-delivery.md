---
title: "Knowledge publication failures"
summary: "Review worktrees run asynchronously; Git diagnostics and retained proposals support safe retries."
author: "worker:39be14591b15"
updated: "2026-10-13"
---
Knowledge notes and indexes are version controlled under `.agent-office/knowledge/`. Publish them through the shelf's separate review branch, rather than committing floor notes with code changes.

`src/server/knowledge/delivery.ts` fetches `origin/main` and runs `git worktree add --quiet -b <review-branch> <temporary-tree> origin/main` asynchronously. Subprocess failures retain stderr, exit code or signal, and the worktree path. Failed records do not prevent a fresh Publish review attempt. Correct the reported Git problem before retrying; inspect retained worktrees before removing them.

Verification: `node --import tsx --import=#tests/css --test tests/knowledge-delivery.test.ts` exercises a failing checkout hook, unchanged live notes and floor HEAD, and successful publication on a new branch after removing the fixture hook.

An earlier failure created a branch without completing a worktree and saved no underlying diagnostic. Its exact cause cannot be reconstructed from that saved record.