---
title: "Diagnose floor-host connectivity, credentials and capabilities"
summary: "Find the owning machine, distinguish offline from unsupported, and recover the original host identity without moving or deleting its checkout."
tags: ["remote","debugging","recovery"]
paths: []
sources: ["docs/floor-hosts.md","docs/boss-mode.md","docs/task-briefs.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Identify the process and machine first

Workers on a hosted floor run on the joiner's machine with its checkout and sign-ins. The central office displays and routes their state. Task-brief AI is an exception: it runs on the office server even for remote floors. Diagnose each operation where it executes.

1. Confirm the floor-host process is still running and which office URL/config it uses.
2. Inspect its terminal error before changing pairing. A host that is offline differs from one connected but lacking the requested capability.
3. If worker startup fails, run the agent CLI's version/sign-in check in the host terminal on the joiner's machine. Fixing only the office server does not fix a hosted worker.
4. If connected but the feature is unsupported, update the relevant office/host components and restart. Do not substitute a local filesystem operation against the office checkout.

## Connection branches

| Evidence | Next action |
| --- | --- |
| Temporary network drop | Keep the process running; automatic retries last ten minutes per outage with backoff |
| Successful reconnect | Retry window resets for a later outage; no new pairing code is needed |
| Retry window expired or process deliberately stopped | Reconnect with node bin/agent-office.js floor-host using saved state |
| Same trusted office has a new URL | Reconnect with --office <new-url> --same-office; this sends the saved token to that address |
| Different office | Use a fresh code and checkout; use --config to keep separate connections |
| Invalid/revoked credential, protocol mismatch or checkout registration failure | Fix the reported issue; these stop immediately rather than retrying |
| Saved identity lost and repository already registered | Stop the host; admin uses Reconnect this machine on the original offline machine and supplies the original checkout path |

Recovery generates a --recover command to replace incorrect saved credentials while preserving the original machine/floors. Do not delete and recreate the floor merely to get past the duplicate-repository message. Revoking a machine is a different, irreversible identity operation; pairing again makes a new machine.

Boss controls show Connecting/Reconnecting while waiting for a live host snapshot; cached work and steering drafts can remain. Only an explicitly connected unsupported host needs the update-host message. A browser refresh cannot speed up host startup.

Pairing requires a trusted office: terminal control runs as the host user and is not container isolation. Keep pairing codes and host tokens out of knowledge notes and PR evidence.
