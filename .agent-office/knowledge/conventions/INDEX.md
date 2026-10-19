---
kind: "index"
summary: "Knowledge about conventions."
---
# conventions

## Entries
- [completion-evidence.md](completion-evidence.md) — Completion reports are worker claims; use the current revision, actual check results and a durable knowledge review before resubmitting. [tags: workers, testing, knowledge] [status: needs-verification]
- [feature-modules-and-registries.md](feature-modules-and-registries.md) — Features are folders that register through the client and server registries; do not add code to main.ts, server.ts, the store or protocol.ts. [tags: architecture, modules] [status: needs-verification]
- [knowledge-auto-sync.md](knowledge-auto-sync.md) — Checkout owners poll pending reviews on startup and every minute, applying merged reviews without overwriting newer edits.
- [knowledge-quality.md](knowledge-quality.md) — Write reusable facts with applicability, evidence, failure cases and verification; maintain indexes and lifecycle instead of accumulating speculative notes. [tags: knowledge, documentation, review] [status: needs-verification]
- [knowledge-shelf.md](knowledge-shelf.md) — How to read, write, move and finish reviewing notes on the floor knowledge shelf under .agent-office/knowledge.
- [pr-delivery.md](pr-delivery.md) — Use a fresh origin/main worktree, preserve shared changes, verify the destination and publish a PR to sagardhande2942/agent-office-sd. [tags: git, pr, workflow] [status: needs-verification] [pinned]
- [security-review-recipes.md](security-review-recipes.md) — Check authorization, input ownership, path confinement, shell arguments and redacted evidence with specific unsafe/safe examples. [tags: security, review, auth] [status: needs-verification]
- [task-brief-recipes.md](task-brief-recipes.md) — A practical task-brief template separates facts, constraints, assumptions and checks, with a worked example for modal behavior. [tags: workflow, planning, workers]
- [task-reasoning-checklist.md](task-reasoning-checklist.md) — A step-by-step reasoning aid for compact models: map the request, read full evidence, trace ownership, use module seams and report observed results. [tags: workflow, onboarding, testing] [pinned]
- [worker-coordination.md](worker-coordination.md) — Message delivery, acknowledgment, reply completion and helper handling are different states; hand off concrete branch and check context. [tags: workers, communication, workflow]
