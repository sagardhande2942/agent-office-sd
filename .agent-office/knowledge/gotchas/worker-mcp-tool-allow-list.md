---
title: "Two tests pin the worker MCP tool allow-list"
summary: "Adding a worker MCP tool breaks tests/workers.test.ts as well as tests/office-workers.test.ts: both assert the exact claude-hooks permissions allow-list."
author: "worker:4aca092bd8d6"
updated: "2026-10-13"
---
The worker MCP tool allow-list is asserted by exact `deepEqual` in more than one test file. Adding a tool under `bin/office-worker-extensions.js` fails until every copy is updated.

- `tests/workers.test.ts` ('every Claude worker gets the office's MCP server, and office-workers on its PATH') reads the generated `claude-hooks.json` and asserts `permissions.allow` equals the full `mcp__agent-office__*` list, including the read-only and mutating tools.
- `tests/office-workers.test.ts` asserts the shipped tool set and the `MCP_READ_ONLY` annotations.

The handoff station added six tools (`handoff_list`, `handoff_read`, `handoff_prefill`, `handoff_create`, `handoff_accept`, `handoff_cancel`). The CLI change updated `tests/office-workers.test.ts` but not `tests/workers.test.ts`, so that test fails on the integration base with the handoff tools as extra values in the `allow` array until its expected list includes them.

When you add or rename a worker MCP tool, grep for `mcp__agent-office__` in `tests/` and update every exact list, then run both files.

Verified 2026-10-14 against base `b77d9f0` in a detached worktree: `node --import tsx --import=#tests/css --test --test-name-pattern="every Claude worker gets the office's MCP server" tests/workers.test.ts` fails with the six `handoff_*` entries as actual-only values.