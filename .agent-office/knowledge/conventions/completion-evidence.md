---
title: "Finish a worker task with evidence and a knowledge review"
summary: "Completion reports are worker claims; use the current revision, actual check results and a durable knowledge review before resubmitting."
tags: ["workers","testing","knowledge"]
paths: ["docs/completion-checklist.md","docs/knowledge.md"]
sources: ["docs/completion-checklist.md","docs/knowledge.md"]
status: "needs-verification"
verified_at: "3679129"
author: "curator"
updated: "2026-10-19"
---
# Task completion evidence

An idle terminal or empty queue does not prove success. The completion checklist records what the worker reports; it does not independently verify checks, publish, merge or finish a queue task.

Read the task's current revision with:

```sh
office-workers completion --json
```

Submit `office-workers complete --json` with a JSON object on stdin. Include the returned `revision`, a summary, named checks with `passed`, `failed` or `skipped` status and evidence, changed file paths, and the actual PR URL. Explain skipped checks. For no file changes, use `files: []` plus `filesNote`; when no PR is applicable or ready, supply `prNote`. The optional `commit` is the actual commit hash. See `docs/completion-checklist.md` for a complete payload.

A substantive new task invalidates the old checklist and increments its revision. Include the revision explicitly in a report prepared earlier so a task change is rejected rather than silently reported against the wrong task.

The default required knowledge policy holds completion until a knowledge review exists for that worker/task revision:

1. Inspect `git diff <base>...HEAD` and identify durable facts, commands, decisions or gotchas.
2. Read existing shared notes before editing and pass their returned `version` as `expectedVersion`. New notes use `null`.
3. Call `knowledge_review_done` with changed knowledge paths, or an explicit `none_reason` when nothing durable changed.
4. Resubmit the checklist after recording the review.

Shared notes belong to the floor knowledge tree, even when the worker's code lives in a separate worktree. List pending knowledge paths in the task PR's Knowledge base updates section; do not copy or commit them from the worker code worktree. Use the shelf's Publish review for separate durable delivery. Local handover journals are evidence, not independently verified knowledge.
