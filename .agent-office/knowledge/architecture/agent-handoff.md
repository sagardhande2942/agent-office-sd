---
title: "Durable worker handoff packets"
summary: "Handoff packets separate explicit recipient acceptance from tracked inbox receipts and retain worker-reported continuation evidence."
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
---
The Handoff station is an independent feature in the office and Lite. Service, CLI/MCP and client implementations are integrated on `feat/agent-handoff-station`.

`src/server/handoff/` owns packet validation, atomic `.agent-office/handoffs.json` storage, worker authentication, host routing and read-only observer API. `src/shared/handoff.ts` is the packet contract. Registry entries connect worker hooks, tools and host RPCs. Hosted observer reads require `handoff.list` in `HOST_CALLS` in `src/shared/floorhost.ts` as well as service registration. Task IDs are `<worker-id>:<completionRevision>`; new offers validate that revision, while identical idempotent retries return the original packet after source revision changes.

`bin/office-handoff-tools.js` registers `office-workers handoff list|read|prefill|create|accept|cancel` and the matching six `handoff_*` MCP tools. Every action POSTs to `/office/workers/handoff` with the authenticated worker's bearer token. Only list/read/prefill are MCP read-only. `create` reads JSON on stdin; explicit empty files/questions require notes, and skipped checks still need evidence.

Client station UI: `src/client/shared/handoff/` is the shared, three.js-free window (`api.ts` fetches `GET /api/handoffs?floor=<floorId>`, `format.ts` renders packet facts, `ui.ts`/`ui.css` is the modal). Both the 3D office and the Lite dashboard open it, and Lite imports only this shared module, so Lite never loads the 3D feature. `src/client/features/handoff/index.ts` registers the HUD action and the `handoffstation` interaction, `features/handoff/world.ts` is the floor fixture kiosk, and `main.ts`/`world/office/build.ts`/`lite.ts`/`lite.html` wire them. The window only reads: it never accepts as a human, fetches on open and on Refresh, surfaces read errors, and states that acceptance records the continuation owner without moving files, resetting a worktree, replacing the recipient's own active task or completing the source task. `tests/handoff-station.test.ts` covers formatting, API parsing/errors, registry+fixture wiring and the no-three.js Lite path.

Progress/checks/files/questions/context are worker-reported. Only the named same-floor coding recipient explicitly accepts. Inbox delivery/acknowledgment and observer views never accept a packet. Acceptance records continuation owner without changing tasks, completions, terminals or worktrees. Source departure/restart retains packets; checkout cleanup can still remove the source folder, so inspect/preserve needed work before departure.

Creation persists first and then uses a stable tracked message key for retryable inbox delivery. Retrying an identical create finishes failed delivery without duplicate packets/messages. Storage errors surface; full ledger refuses new offers at 1,000 retained packets rather than evicting history.

Verification:
```
npm run typecheck
npm test
npm run build
node --import tsx --test tests/handoff.test.ts tests/handoff-server.test.ts tests/handoff-tools.test.ts tests/handoff-station.test.ts tests/size.test.ts
node --import tsx scripts/e2e-handoff.mjs
```

The focused suite covers source/recipient flow, unauthorized acceptance, revisions, retries, restart/departure, non-interruption, storage failure, CLI/MCP schema, floor-host wire registration and the client station structure. The browser harness uses a real isolated office and authenticated tools, and writes screenshots/checks to `/tmp/agent-office-handoff-evidence` (`HANDOFF_ARTIFACTS` overrides). Operational semantics are in `docs/agent-handoff.md`. Publish shelf changes separately from the implementation PR.
Final validation: `npm run typecheck` and `npm run build` passed. `npm test -- --test-concurrency=4` passed 1,381 tests with zero failures and one existing skip (1,382 total); reduced concurrency avoids the clone-resume fixture's 1.5-second stall threshold under load. The real-office headless harness passed packet rendering, explicit worker acceptance, fixture/menu access, modal close placement, and immediate mouse-look restoration for ✕ and Esc. A station screenshot is retained at `docs/images/agent-handoff-station.png`; all browser artifacts and `checks.json` are under `/tmp/agent-office-handoff-evidence`.
