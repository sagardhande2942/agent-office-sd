---
title: "Know what survives restarts and what a new task invalidates"
summary: "A state lifecycle map for checklists, knowledge, communications, task briefs, worker roles and Boss initiatives."
tags: ["state","workers","persistence"]
paths: []
sources: ["docs/completion-checklist.md","docs/knowledge.md","docs/communications.md","docs/task-briefs.md","docs/boss-mode.md","src/server/knowledge/worker.ts","src/server/worker-roles/service.ts"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Persistence is not continued validity

A saved record can survive restart while no longer describing current work. Determine its owner, revision and invalidation event before reusing it.

| State | Lifetime / owner | Invalidation or boundary |
| --- | --- | --- |
| Worker completion checklist | Local worker state until replaced or worker leaves | New substantive prompt or cleared/replaced conversation increments revision and invalidates checklist; continuation and bare slash commands do not |
| Finished queue checklist snapshot | Queue task, retained after worker departure/restart | Requeue creates a fresh attempt; later worker reports do not rewrite the old snapshot |
| Knowledge review record | Local floor _meta/state/reviews.json, keyed by worker and completion revision | A review for an earlier revision does not satisfy the current required completion gate |
| Knowledge notes/indexes | Committed shared floor tree, independent of worker code worktree | Pending edits are live but unpublished; curator branches require merge and synchronization |
| Knowledge deliveries/usage/journals | Floor-local, gitignored review state and handovers | A repository clone is not their backup; retain snapshots for reconciliation |
| Worker communications | Persistent per-floor ledger, survives worker exit/restart | Bounded retention removes old completed/expired threads together, not unresolved requests |
| Meeting communication snapshot | Saved alongside meeting output when it ends | Later replies do not rewrite the snapshot; receipts are not automatic meeting decisions |
| Helper report | Retained ledger report plus manual delivery card | Inbox acknowledgment or successful terminal delivery completes the same report; handling is not proof of a fix |
| Task brief draft | Current dialog only | Applying does not hire/send; editing original request requires rebuilding; closing discards draft and aborts AI request |
| Worker role | Per-floor persisted assignment | Explicit role directive changes/clears it; worker departure removes it; direct terminal typing bypasses prompt decoration |
| Boss initiative | Project boss-mode.json and per-initiative team state | OFF drains current work; Stop now preserves and suspends it; ON reconciles preserved work before new initiatives |

## Questions for a state change

- Who owns the authoritative value: browser, account, office, floor checkout, host or provider session?
- What happens on floor arrival, socket close, worker removal and office/host restart?
- Which revision/version prevents an old asynchronous result from overwriting newer work?
- Is the persisted value an accepted fact, proposed change, reported claim or historical snapshot?
- Are corrupt records reported and preserved, or silently replaced? Existing communication and Boss persistence report corruption without overwriting it.

Example: a worker submitted revision 4, then received a new task at revision 5. The old successful checklist and revision-4 knowledge review cannot certify revision 5. Read the current revision and perform the new review; do not rewrite the old queue attempt as if it had used the new result.
