---
title: "Add a worker tool across CLI, MCP, hooks and floor hosts"
summary: "Trace registration, authentication, read-only annotations and lifecycle hooks when adding a worker-facing command."
tags: ["workers","mcp","auth"]
paths: ["bin/office-worker-extensions.js","src/server/hooks/**","src/server/worker-features.ts"]
sources: ["docs/code-layout.md","bin/office-worker-extensions.js","bin/office-knowledge-tools.js","src/server/hooks/worker-features.ts","src/server/knowledge/hooks.ts","src/server/worker-features.ts","src/server/workers/features.ts"]
status: "needs-verification"
verified_at: "3679129"
author: "curator"
updated: "2026-10-19"
---
# A schema is only one layer

Use the Knowledge extension as the concrete example. A CLI command, MCP schema, authenticated endpoint, service operation and hosted-floor path are separate pieces. Adding a name to one list does not connect or authorize the others.

1. Define the operation in its own service module, including bounds, validation and identity rules.
2. Add an extension module under bin/ and register it in office-worker-extensions.js. Supply parser/commands, actions, HTTP paths, tool schemas, help and read annotations as applicable.
3. Register the authenticated worker endpoint in server/hooks/worker-features.ts so office and floor-host listeners use the same route table.
4. Authenticate with the caller's own hook token. Check the role before work; recheck identity and role after asynchronous body reads when the session may have changed. The Knowledge hook demonstrates both checks.
5. Derive author, worker identity and task revision from authenticated server state. Reject unknown identity fields rather than accepting a submitted author as proof of ownership.
6. When needed, register host calls and snapshots in server/worker-features.ts and the relevant remote bridge. Verify disconnected and unsupported hosts explicitly.
7. For prompt/completion/update/remove behavior, implement a WorkerFeature through the lifecycle registry instead of adding feature logic to the manager.
8. Update precise permission/tool lists and test every changed entry point. Search tests for the tool name and mcp__agent-office__ before assuming one list is enough.

## Read-only means no mutation

An operation that records delivery, acknowledgment, usage or other durable state may mutate even if its visible result looks like a read. For example, worker_inbox marks messages delivered and is intentionally not a read-only MCP tool. Classify the actual behavior, not the command's English name.

## Verify the contract

Use tests/office-workers.test.ts for CLI/MCP contracts and tests/workers.test.ts for generated worker permissions. Knowledge has tests/knowledge-tools.test.ts and tests/knowledge.test.ts for authenticated tools and store guards. Pick analogous feature coverage rather than weakening exact assertions to hide a missing registration.

Exercise unauthorized token/role, bad input, changed session, success, repeated request and hosted behavior where relevant. Document whether retries are idempotent before retrying a mutating command after a timeout.
