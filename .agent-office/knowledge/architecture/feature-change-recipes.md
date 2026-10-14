---
title: "Choose the right files for a feature, setting or prompt editor"
summary: "Concrete file and registry recipes for floor features, browser-local settings and shared prompt editors."
tags: ["architecture","ui","modules"]
paths: ["src/client/features/**","src/client/ui/**","src/server/ws/handlers/**"]
sources: ["docs/code-layout.md","src/client/ui/settings-extensions.ts","src/client/ui/prompt-tools.ts","src/client/features/performance/index.ts","src/server/http/router.ts","src/server/ws/handlers/types.ts"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Start by deciding who owns the state

| State | Design starting point |
| --- | --- |
| Browser-only preference | Feature-local client module, existing persistence API and Settings extension; no server message just to remember a local preference |
| Shared floor state | Server service, domain protocol, floor handler/view and dedicated client slice |
| Building/account administration | Existing office/account service and explicit role checks; do not store it as a player-only preference |
| Hosted checkout state | Owning floor service plus remote host RPC/capability support; the office cannot read the host's disk |

## Recipe: a shared floor feature

1. Put behavior in its own server service and client features/<name>/ folder. Read a nearby complete feature for conventions.
2. Define messages in src/shared/protocol/<domain>.ts. Compose exports and unions in protocol.ts; do not add runtime feature logic there.
3. Add src/server/ws/handlers/<domain>.ts with a map satisfying HandlerMap<ItsClientMsg>; register it in handlers/index.ts.
4. If the feature keeps per-person resources, register leaving/closed hooks. If arriving clients need its state, add its FloorView field and registered view piece.
5. Add a state/slices/<name>.ts module and append it to SLICES. Register messages, keys, ticks and interactions through ctx in install<Name>.
6. Keep main.ts changes to composition entries and explicit dependency wiring. Place CSS alongside the feature UI. Add help and document operation.
7. For hosted floors, trace the remote call, allow-list, capability, snapshot and event path too. Local success alone does not establish remote support.

Check tests/client-structure.test.ts, tests/client-registry.test.ts, tests/server-dispatch.test.ts and tests/size.test.ts. New TypeScript/CSS modules must stay within 600 lines; split modules instead of raising ceilings.

## Recipe: a browser-local setting

Read src/client/features/performance/index.ts: it registers through ui/settings-extensions.ts rather than adding a feature's UI inside the Settings implementation. An extension chooses a pane and returns element plus dispose(). Ensure disposal releases listeners/subscriptions. Use the existing setting/persistence mechanisms; decide whether the value is local or shared before choosing transport.

## Recipe: a prompt editor used in Lite and game views

Keep reusable code under src/client/shared/. Add its factory to PROMPT_TOOLS in ui/prompt-tools.ts. Return element and valid(); unfinished drafts must prevent the parent prompt from submitting. Read shared/task-brief/ for an example. Do not import 3D features, world, player, input or core into Lite's shared UI.

## Recipe: an HTTP route

Create a route module and register it in server/http/routes/index.ts. The Route type requires public or session authentication explicitly. A session proves sign-in, not permission to administer a floor; perform the feature's authorization checks as well. Route order matters because the first matching route handles the request.
