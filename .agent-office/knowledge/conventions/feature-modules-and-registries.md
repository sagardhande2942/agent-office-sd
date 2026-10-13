---
summary: "Features are folders that register through the client and server registries; do not add code to main.ts, server.ts, the store or protocol.ts."
title: "Features plug in through registries, not into the big files"
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
---
`docs/code-layout.md` in the repository is the full reference and stays accurate; this note is the short version to remember before you start.

The office used to grow by editing the middle of four big files (the server message switch, the page key handler, its frame loop, its store). Each is a registry now, and a feature is a folder plus one line in each list it joins: the client registries in `src/client/core/registry.ts` (`ctx.messages`, `ctx.keys`, `ctx.ticks`, `ctx.activities`, `ctx.interactions`, `ctx.view`, `ctx.windowOpened`, `ctx.usables`), the server's `handlers` map in `src/server/ws/handlers/index.ts` plus its `features` and `views` lists, `SLICES` in `src/client/state/slices/index.ts`, and the install list at the end of `src/client/main.ts`.

If a change has you editing the middle of `main.ts`, `server.ts`, `src/client/state/store.ts` or `src/shared/protocol.ts`, it probably belongs in a module of its own. Parts communicate through a `deps` object or a `Pick<Parts>` (`src/client/core/parts.ts`), never by importing `main.ts`; a test enforces that.

Tests that hold this shape together: `tests/client-structure.test.ts` (every feature's install called once, Lite's import boundary), `tests/client-registry.test.ts` (ordering and dispatch, every interaction kind defined once), `tests/server-dispatch.test.ts` and `tests/size.test.ts`.