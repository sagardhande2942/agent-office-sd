---
summary: "A fresh worktree has no node_modules and no dist: symlink the main checkout's node_modules and run npm run build before typecheck, tests or browser checks."
title: "Worktrees need node_modules symlinked and a client build"
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
---
Each worktree under `.agent-office/worktrees/<name>-<id>/` is a plain checkout with **no `node_modules`**. `npm run typecheck`, `npm test` and `npm run build` all fail there with `Cannot find package …` or `ENOENT …/node_modules/@excalidraw/excalidraw/package.json` until you point it at the main checkout's:

```
cd .agent-office/worktrees/<name>-<id>
ln -s /home/<user>/<repo>/node_modules node_modules
npm run build        # writes dist/public
```

`node_modules` is git-ignored, so the symlink never shows up in the worker's diff.

Several server tests (`tests/communications-server.test.ts`, `tests/completion-server.test.ts`, `tests/manager-server.test.ts`, …) start the real server and fail with **"Client bundle not found … Run `npm run build`"** until `dist/public` exists in the worktree. Build before running the full suite, not just before the browser checks.

`tests/cabinet.test.ts` has been seen failing under the load of a full parallel `npm test` and passing when run alone (`node --import tsx --import=#tests/css --test tests/cabinet.test.ts`): treat a single failure there as flaky until you have rerun it on its own.
