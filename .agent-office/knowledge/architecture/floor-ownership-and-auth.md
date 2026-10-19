---
title: "Trace floor ownership and worker authorization before touching remote features"
summary: "Hosted floors execute on their checkout owner; route through host RPCs and recheck worker identity and role after asynchronous request reads."
tags: ["remote","auth","workers"]
sources: ["docs/floor-hosts.md","docs/knowledge-architecture.md","src/server/hooks/worker-features.ts","src/server/knowledge/hooks.ts"]
paths: ["src/server/hooks/worker-features.ts","src/server/knowledge/hooks.ts"]
status: "needs-verification"
verified_at: "3679129"
author: "curator"
updated: "2026-10-19"
---
# Which machine owns the operation?

A hosted floor's checkout, agents and sign-ins live on its floor host, not on the central office machine. The host dials outward to the office. A browser prepares join commands but cannot replace the host process that reads disk and launches agents.

For a feature that reads or writes project files, trace its complete path:

Browser request -> floor-scoped server handler -> local service or host RPC -> owning checkout -> floor-scoped response/event.

For Knowledge, the host RPC is knowledge.execute through the host-call allow-list; knowledge/surface.ts and knowledge/host.ts keep local and hosted human actions equivalent. Worker APIs share the route table in src/server/hooks/worker-features.ts. Implement a feature through the corresponding registries rather than adding a central-office fallback that reads a path belonging to the host.

Example: a remote worker lacks an agent CLI. Verify that command on the joiner's machine and restart the host after fixing PATH. Installing it only on the office server cannot fix a process launched elsewhere.

## Authentication survives asynchronous work

The Knowledge hook authenticates the worker ID with that worker's own bearer hook token, then checks the role. After awaiting the request body it authenticates and checks the role again. A worker can leave, rotate its session or become a locked participant while the request is being read.

Retain both checks when modifying the hook. Identity and completion revision come from the authenticated worker, not JSON fields. Unknown fields are rejected; author and updated metadata are server-owned. Do not trust a submitted worker ID, author or task revision as proof of ownership.

Knowledge access is for coding agent workers. Helpers, meeting participants, locked plan-review participants, shell workers and station workers are rejected by the hook. Adding a tool to MCP schemas is not sufficient authorization to execute it.

## Connectivity is not capability

A disconnected host is different from a connected host that reports an unsupported operation. Respect explicit capability checks and propagate a useful host error. Do not treat a disconnected host as a local floor or serve invented empty state as success.

Hosting is not container isolation: workers run as the host user, and office members can control their terminals. Role instructions guide behavior; they do not create a machine sandbox. Consult docs/floor-hosts.md before changing pairing, credentials or terminal access.

Relevant coverage: tests/remote-floor.test.ts, tests/remote-lore.test.ts, tests/knowledge-tools.test.ts and tests/floorhost.test.ts.
