---
title: "What this repository is"
summary: "agent-office: a 3D multiplayer office where agent CLIs work at desks, with a server, a Lite dashboard and many floor features."
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
---
`agent-office` is a cartoon 3D multiplayer office (TypeScript, Vite client, Node server) where a team spawns coding agents at desks, watches their live terminals, talks to them and tracks their pull requests.

- `package.json` name `agent-office`, type `module`, Node >= 20, binary `agent-office` from `bin/agent-office.js`.
- Three source trees: `src/client` (the page, three.js, built by Vite), `src/server` (Node, HTTP + WebSocket + hook server + worker manager) and `src/shared` (types and pure code both use; no Node imports).
- One HTML entry per client flavour: the 3D office, `game2d.html` (a top-down 2D view that reuses the same composition through `features/topdown`), and the Lite dashboard at `/lite`, which must stay free of three.js and of `core/`, `features/`, `input/`, `world/`, `player/`.
- Agent CLIs are adapters: one file in `src/server/providers/`, one row in `PROVIDERS`, one row in `src/shared/providers.ts`. The typecheck fails until all three exist.

The full map of where code goes is `docs/code-layout.md` in the repo; read it before adding anything. `README.md` is the user-facing manual and `docs/*.md` are the per-feature pages, and they are expected to change in the same pull request as a behaviour change.

Verify any of this against the checkout before trusting it: the repo moves fast and this note is not a substitute for reading the code.