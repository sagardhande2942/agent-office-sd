---
title: "Knowledge edits and review synchronization have separate safety guards"
summary: "A read version protects one edit; merge synchronization protects the entire proposal. Reread and reconcile conflicts instead of forcing writes."
tags: ["knowledge","concurrency","git"]
sources: ["src/server/knowledge/store.ts","src/server/knowledge/delivery.ts","docs/knowledge.md"]
paths: ["src/server/knowledge/store.ts","src/server/knowledge/delivery.ts"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Three different states

Keep these separate: the live floor notes, a published proposal branch, and the approved content on main. Every worker reads the same floor tree even when its code lives in another worktree. Curator proposals stay on their review branch until merged and synchronized.

## Editing one note

1. Read with knowledge_read; retain both its text and version.
2. Modify that text and write with expectedVersion set to the returned version. A new note uses null.
3. If rejected as changed, reread and preserve the other writer's edits before retrying with the new version.

Example: workers A and B read version V1. A saves V2. B's write using V1 must fail; replacing expectedVersion with V2 without reconciling the new text defeats the purpose of the guard. Move and archive also require the source's current version.

The filesystem lock serializes mutations. The version check runs inside the lock; a lock alone cannot determine whether a writer's input is stale. Atomic file replacement alone cannot prevent lost updates.

## Synchronizing a reviewed proposal

Open review: leave it pending. Closed review: preserve live notes. Merged review: preflight every affected path before applying the complete set. Live content must still match the captured snapshot or accepted result, and upstream content must match the proposal. A move includes both source removal and destination creation.

Example: a proposal moves old.md to new.md, but another worker creates new.md before sync. Stop the whole application and reconcile; do not delete old.md first. A newer live edit to one note also blocks the complete proposal, rather than partially applying other notes.

Automatic sync runs on the checkout owner at startup and every minute. Sync approved shares the same in-flight synchronization. Repeatedly clicking it does not resolve content conflicts. Back up and inspect the retained snapshots and PR using project/data-and-recovery.md.

## When changing this implementation

Preserve snapshot checks for every action and destination. Validate a full curator plan before editing: a note may participate in only one action in a plan. Do not catch a version conflict and blindly retry the old body, bypass locks, switch the floor branch to a proposal, or mutate live notes before curator approval.

Relevant coverage: tests/knowledge.test.ts, tests/knowledge-delivery.test.ts, tests/knowledge-curator-plan.test.ts and tests/knowledge-auto-sync.test.ts.
