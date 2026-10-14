---
title: "Live office discovery probes can reach HTTP test fixtures"
summary: "GET / with user-agent agent-office is an incidental floor probe; the MCP fixture now injects it deterministically and excludes only that exact probe from request accounting."
author: "worker:ab37cab0c171"
updated: "2026-10-14"
status: "active"
---
Services in src/server/services.ts scans listening sockets and probes listeners attributed to a worker worktree. The request is GET / with user-agent agent-office and accept text/html,*/*. HTTP fixtures that record every request can therefore fail exact-list assertions while a real floor is running.

The observed example was tests/office-workers.test.ts, 'office-workers mcp serves a real client over stdio, as the worker': it expected one authenticated MCP request but could receive the discovery request first. The fixture now returns 404 for precisely GET / with user-agent agent-office before recording requests. It sends that probe itself before the MCP call, so the regression is checked without relying on floor discovery timing. Every other request remains in the exact assertion.

Use the same narrow handling when a fixture has this contract; do not broadly discard unknown paths or requests, which could conceal real regressions. Run `npm run test:focus -- tests/office-workers.test.ts` while editing, and include the full suite before publishing.

Related historic load failures include tui-session.test.ts and clone.test.ts. A passing isolated retry is evidence of possible contention, not proof of a fix. This task's baseline full profile also timed out worker-shutdown.test.ts during cold imports; its seven-second lifecycle guard now starts after imports, with a separate bounded startup timeout. See project/testing-efficiently.md.
