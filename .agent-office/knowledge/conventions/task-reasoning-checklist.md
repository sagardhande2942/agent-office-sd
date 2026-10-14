---
title: "Break unfamiliar tasks into evidence, boundaries and acceptance checks"
summary: "A step-by-step reasoning aid for compact models: map the request, read full evidence, trace ownership, use module seams and report observed results."
tags: ["workflow","onboarding","testing"]
sources: ["AGENTS.md","docs/code-layout.md","docs/knowledge.md","docs/completion-checklist.md"]
paths: []
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
pinned: true
---
# A bounded workflow for unfamiliar code

This is a reasoning aid, not a claim about any model's measured performance. Use it when context is short or the task crosses client, server, remote-host and persistence boundaries.

1. Translate the request into observable outcomes. For example, “close the dialog with Esc and resume mouse-look” needs a focus/control check, not just a visible close button.
2. Read AGENTS.md, the relevant knowledge note and its cited source. Bootstrap includes summaries, not note bodies. Search hits include adjacent lines, not complete functions. Use knowledge_read or read the full implementation before inferring behavior.
3. Trace inputs, ownership, persistence and outputs. Write down which machine owns the checkout, which worker identity authorizes the call, what state survives restart, and who receives the event. Use architecture/floor-ownership-and-auth.md for remote/auth changes.
4. Choose the feature module and registry seams from docs/code-layout.md. Keep composition roots as install lists; use a protocol domain, handler, state slice and feature folder as needed. For shared 2D/3D/Lite UI, read gotchas/modal-and-client-boundaries.md.
5. Identify one realistic failure case before editing: a stale version, host disconnect, worker removal during a request, or closing one modal into another. Preserve that behavior rather than adding an unconditional “success” fallback.
6. Verify actual outcomes with the required typecheck, tests and build, plus appropriate browser evidence for visual changes. Build before server integration tests because they require dist/public. Report failures honestly; naming a command is not evidence it passed.
7. Review the diff for unintended scope, update durable knowledge, record the current task's knowledge review, and deliver the project PR using conventions/pr-delivery.md.

## Stop guesses from turning into facts

Distinguish repository behavior, a proposed design and an observed result. A worker-reported checklist or journal is evidence to inspect, not independent verification. A model's plan score is not proof that its repository claims are true. If a cited excerpt is incomplete, read the underlying file before changing a human-verified note.

When evidence is missing, record the specific unresolved question instead of inventing a command, path or supported remote capability. Do not flag an active human-verified note merely because a referenced file changed: curation requires cited contradictory evidence plus a concrete contradiction for that downgrade.

Avoid shortcuts that erase context: blindly retrying a stale note body, treating a successful local commit as PR delivery, changing size-test ceilings instead of splitting a module, or assuming a worker role creates sandbox isolation. The focused notes above explain the relevant guards and recovery paths.
