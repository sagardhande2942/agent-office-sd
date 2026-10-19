---
summary: "Features are folders that register through the client and server registries; do not add code to main.ts, server.ts, the store or protocol.ts."
title: "Features plug in through registries, not into the big files"
author: "curator"
updated: "2026-10-19"
status: "needs-verification"
tags: ["architecture","modules"]
sources: ["AGENTS.md","docs/code-layout.md","src/client/core/registry.ts","src/server/ws/handlers/index.ts","src/client/state/slices/index.ts"]
paths: ["src/client/features/**","src/server/ws/handlers/**"]
verified_at: "3679129"
---
`docs/code-layout.md` in the repository is the full reference and stays accurate; this note is the short version to remember before you start.

The office used to grow by editing the middle of four big files (the server message switch, the page key handler, its frame loop, its store). Each is a registry now, and a feature is a folder plus one line in each list it joins: the client registries in `src/client/core/registry.ts` (`ctx.messages`, `ctx.keys`, `ctx.ticks`, `ctx.activities`, `ctx.interactions`, `ctx.view`, `ctx.windowOpened`, `ctx.usables`), the server's `handlers` map in `src/server/ws/handlers/index.ts` plus its `features` and `views` lists, `SLICES` in `src/client/state/slices/index.ts`, and the install list at the end of `src/client/main.ts`.

If a change has you editing the middle of `main.ts`, `server.ts`, `src/client/state/store.ts` or `src/shared/protocol.ts`, it probably belongs in a module of its own. Parts communicate through a `deps` object or a `Pick<Parts>` (`src/client/core/parts.ts`), never by importing `main.ts`; a test enforces that.

Tests that hold this shape together: `tests/client-structure.test.ts` (every feature's install called once, Lite's import boundary), `tests/client-registry.test.ts` (ordering and dispatch, every interaction kind defined once), `tests/server-dispatch.test.ts` and `tests/size.test.ts`.

## Implementation sequence

For a new floor feature, work through the seams in this order:

1. Add domain message types in src/shared/protocol/<domain>.ts and compose those types in protocol.ts; keep logic out of the protocol composition file.
2. Add the server service and handler; register handlers, any leaving/closed hooks and arriving-floor views in ws/handlers/index.ts.
3. Add a dedicated state slice and append it to SLICES, preserving topic order.
4. Add features/<name>/ with install<Name>(ctx, deps); the main.ts change is only its composition entry. Register keys, ticks, interactions and messages through ctx.
5. Add feature-local UI/CSS, help and tests. Use the existing modal lifecycle and check Lite's import boundary if sharing UI.

For worker lifecycle, use server/worker-features.ts; for worker HTTP, hooks/worker-features.ts; for CLI/MCP, bin/office-worker-extensions.js. Adding a browser handler does not automatically expose a worker tool or remote host RPC.

The size guard caps new TypeScript/CSS modules at 600 lines. Split oversized files along these seams; never raise a ceiling to fit the feature. When a grandfathered file shrinks, lower its ceiling; when it reaches 600 lines or disappears, remove its exception. Refer to docs/code-layout.md for fixture/type augmentation and provider-specific registration details.
