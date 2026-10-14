---
title: "Give compact models bounded tasks with observable acceptance"
summary: "A practical task-brief template separates facts, constraints, assumptions and checks, with a worked example for modal behavior."
tags: ["workflow","planning","workers"]
paths: []
sources: ["docs/task-briefs.md","docs/completion-checklist.md","docs/code-layout.md","AGENTS.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Supply the missing decisions, not just more prose

This is a task-writing technique, not a claim that a particular model will succeed. Use concrete boundaries and evidence when a model has limited context or an unfamiliar codebase.

Include:

1. Goal: observable user outcome and the triggering action.
2. Evidence: relevant files, current behavior and any reproduced error.
3. Scope: what this task changes and existing invariants it must preserve.
4. Acceptance: checks someone can observe, including one failure/edge case.
5. Verification: exact commands and required browser assertions/artifacts where appropriate.
6. Open questions: uncertain facts kept separate from requirements.
7. Delivery: isolated worktree, project PR target, documentation and knowledge review requirements.

## Worked example: a modal close bug

Goal: when closing the feature dialog with its top-right ✕ or Esc, return to office mouse-look without an extra click.

Evidence to inspect: the feature's UI module, src/client/ui/dom.ts and src/client/input/focus.ts. Describe the actual reproduction and terminal/browser errors if known.

Constraints: use the existing modal lifecycle; keep behavior in the feature module; preserve other open windows and avoid pulling 3D code into Lite.

Acceptance: both close paths work; movement/key state is restored after the last modal closes; replacing the modal with another keeps the cursor released; typing focus is respected.

Verification: required npm checks plus a feature-specific headless interaction check and screenshot. A screenshot alone cannot prove pointer-lock/control behavior.

Unknowns: identify which modal helper the feature uses after reading its implementation. Do not guess a function signature or add a duplicate focus controller.

## Using the office brief builder

Manual drafting makes no provider calls. AI drafting proposes details; review them, especially invented examples and assumptions. Applying Use brief does not hire/send: the existing submit action starts the task. Editing the original request requires rebuilding; drafts exist only in the current dialog.

AI drafting runs on the office server even for remote floors, with isolated tools/configuration as documented in docs/task-briefs.md. Closing/canceling aborts the request, failures preserve existing details, and the completed prompt must fit the 20,000-character limit including attached issue/PR context.

## When a result is weak

Compare the implementation with each acceptance condition and read the cited files. Ask for the missing observable behavior with concrete evidence. Do not accept a fluent explanation, plan score or reported checklist as independent proof that the code works. Update durable knowledge after verification, not from the proposed approach alone.
