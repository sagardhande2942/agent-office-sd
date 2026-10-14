---
title: "Locate office data and preserve it during recovery"
summary: "Distinguish building data, project checkouts, shared knowledge and local review state before moving folders or recovering publication."
tags: ["configuration","recovery","knowledge"]
paths: ["docs/configuration.md","docs/knowledge.md"]
sources: ["docs/configuration.md","docs/knowledge.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Data locations and recovery

In building mode, office data defaults to `~/agent-office`; `--home` or `AGENT_OFFICE_HOME` relocates it. New project floors default to `~/agent-office/<owner>/<repo>`. An admin can choose a Workspace folder in Building settings, or use `--projects` / `AGENT_OFFICE_PROJECTS`. This changes where new floors are cloned; existing floors stay where they are.

Building metadata lives under the office home's `.agent-office/`: `map.json`, `floors.json`, custom `maps/` and per-account sign-ins in `homes/<account>/`. Each floor's own checkout holds its workers, queue, worktrees and other state under `.agent-office/`. Starting with `agent-office <project-dir>` keeps office data in that project's `.agent-office`; do not assume building-mode locations for an existing project-mode office.

The floor's default shared knowledge root is `.agent-office/knowledge/`. Notes and indexes are committed; `_meta/state/` and `.agent-office/handovers/` are local and gitignored. A Git clone is therefore not a backup of pending edits, journals or review snapshots. Preserve these separately before host recovery. Never paste account credentials or tokens into notes or PR evidence.

For failed knowledge publication, read the reported Git diagnostics and retained worktree path first. Fix the actual failure, then retry Publish review. Failed proposal branches/worktrees can contain recoverable work; inspect them before removing anything.

For approved-review synchronization conflicts, compare the PR, live files and the retained snapshots in `_meta/state/deliveries.json`. Synchronization stops the whole application of the proposal if live notes changed or destinations collide. Back up local state, reconcile to the accepted proposal, then retry Sync approved. If the published PR was edited, its recorded after snapshot also needs reconciliation to the reviewed merged content; see `docs/knowledge.md` for host recovery details.

A crashed writer can leave `_meta/state/write.lock`. Remove that empty lock directory only after confirming no host or CLI is writing. A lock's presence by itself is not evidence that it is stale.

For worker cleanup, start with `agent-office prune <project-dir> --dry-run`. Prune preserves dirty or unpushed work unless forced. Do not use force as a routine recovery step.
