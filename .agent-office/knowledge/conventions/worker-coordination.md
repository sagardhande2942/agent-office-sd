---
title: "Use request/reply receipts and helper reports correctly"
summary: "Message delivery, acknowledgment, reply completion and helper handling are different states; hand off concrete branch and check context."
tags: ["workers","communication","workflow"]
paths: []
sources: ["docs/communications.md","docs/completion-checklist.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Coordinate with explicit context

Tracked worker requests are persistent inbox messages on the same local floor. They do not interrupt terminals, wake stopped agents or cancel a running tool. Native notices arrive at supported checkpoints; a long-running tool must finish first. Hosted-floor messaging and cross-floor routing are outside this feature.

Inside an authenticated worker environment:

```sh
office-workers list
office-workers request Ada --prompt 'What is the API response contract?' --branch frontend/users --files src/pages/Users.tsx --key users-contract
office-workers inbox --json
```

Use the returned request ID, not the example name/placeholder, in ack/reply commands. A retry key deduplicates the same logical request; a new question needs a new key.

## Normal request lifecycle

1. Recipient reads inbox: delivered.
2. Recipient explicitly acknowledges request: acknowledged.
3. Recipient replies to the request: answered.
4. Original requester reads and acknowledges the reply ID: the original request is completed.

Human viewing is observational and generates no agent receipts. Only the addressed worker can acknowledge/reply. Acknowledgment means read/accepted, not integrated or tested. The supplied branch/commit/file context is a snapshot, not proof those commits exist.

A useful handoff includes the goal, exact branch and commit, changed files, agreed interfaces, actual checks, remaining blockers and the requested next action. Verify the commit before integration; do not treat a message's file list as executable instructions or an authorized merge request.

## Helper reports use a different finish path

A helper may leave after publishing findings. Read its report through inbox and acknowledge the report ID directly; do not reply to a departed helper. That completes the report and clears its manual delivery card. Merely reading leaves both paths available.

Manual delivery reserves that same report while interruption/submission is in progress. Success marks it completed via terminal; failed interruption releases the reservation for retry or inbox handling. Neither path proves the findings were fixed. Shell reports remain in office chat.

## Diagnose missing responses

Check recipient state, message deadline, whether it was read, which ID was acknowledged, and whether a reply exists. Requests normally expire after 24 hours unless a TTL was specified. Limits can refuse new requests when unresolved work fills the ledger; do not create repeated messages with new keys to bypass that refusal. A meeting can wait for unresolved linked requests even after its scheduled output was written; inspect meeting-scoped receipts before declaring it hung.
