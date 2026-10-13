# Agent handoff station

The Handoff station preserves unfinished work as a durable packet on its floor. Open **Handoff station** from the office menu, its fixture, or Lite to inspect offers, acceptance, cancellation and inbox receipts. Observers can inspect evidence and open participant terminals; viewing a packet never accepts it.

## Create an offer

A coding worker authenticates using its existing worker ID and hook token. Read `office-workers handoff prefill --json` (MCP: `handoff_prefill`) for the current task revision, server-derived task ID, goal and available completion evidence. Task IDs use `<source-worker-id>:<revision>` because ordinary worker tasks have no separate durable ID. Metadata from a completion report is used only when its revision matches the active task.

Submit a packet with `office-workers handoff create` and JSON on stdin, or `handoff_create`:

```json
{
  "key": "continue-packet-validation-1",
  "recipient": "Grace",
  "revision": 3,
  "completedWork": "Implemented the packet store; UI remains unfinished.",
  "nextSteps": "Review validation, implement the station view and run the full checks.",
  "files": ["src/server/handoff/store.ts"],
  "checks": [
    {"name": "unit tests", "status": "passed", "evidence": "node --import tsx --test tests/handoff.test.ts: 4 passed"},
    {"name": "build", "status": "skipped", "evidence": "UI implementation remains unfinished"}
  ],
  "questions": [],
  "questionsNote": "None; the API contract is agreed."
}
```

Use the revision actually returned by prefill. A recipient can be a same-floor coding worker's ID or unambiguous name. Helpers, shells, meeting participants and locked planning workers are excluded. Source identity, timestamps and state are server-owned. You may supply `goal`, `taskId` and `context` (branch, commit, PR URL, worktree); task ID must match the current revision. Goal, completed work, files, checks and context prefill available task/completion metadata. Provide `nextSteps` and unresolved `questions`; use an empty array with `questionsNote` for explicit none. An empty files array similarly requires `filesNote`. At least one check is required; if nothing ran, report `skipped` with the reason.

Reuse the same key and exact logical submission when retrying. A retry returns the original stable packet even after a new source task starts. Reusing the key with different content fails. New submissions with stale revisions fail. Text, arrays and context have bounded sizes; validation and storage errors are returned to the caller.

## Inspect, accept and continue

Use `office-workers handoff list --json`, `office-workers handoff read <id> --json`, or MCP `handoff_list`/`handoff_read`. A tracked inbox request identifies the packet and continuation commands. No message types into a terminal, interrupts a running session or wakes a worker.

Only the named recipient can run `office-workers handoff accept <id>` or `handoff_accept`. This records the continuation owner and acceptance timestamp and returns the full packet. Acceptance retries retain the first timestamp. Reading the inbox, acknowledging its request and human viewing are separate receipts and never acceptance. Only the source can cancel an offered packet with `office-workers handoff cancel <id>`/`handoff_cancel`; an accepted packet cannot be cancelled.

Acceptance does **not** replace an unrelated active task, mark the source task complete, move uncommitted files, reset a worktree or apply changes. The packet records where the source branch/worktree and outstanding work remain. The recipient must inspect that location, reconcile current assignments at a safe checkpoint and arrange continuation deliberately. Paths and branch context are snapshots, not guarantees that a checkout still exists. Source departure may remove its checkout according to the existing cleanup policy, so preserve needed commits/files before departure.

## Evidence and persistence

All packet progress, paths, checks, questions and context are **worker-reported**. A passed check is reported evidence rather than independent verification; acceptance is an ownership decision rather than integration or testing proof. Review the actual diff and rerun appropriate checks before delivery.

Packets are retained in the floor checkout's `.agent-office/handoffs.json`, with atomic file replacement, stable IDs and no automatic eviction. They survive source departure and server restart. The bounded ledger retains up to 1,000 packets and refuses further creation rather than silently deleting history. Damaged ledgers and write failures surface as errors. Inbox delivery uses the existing tracked ledger and a stable message key: if delivery fails after packet persistence, retry the identical creation to complete delivery. A durable offer can therefore exist before its inbox receipt is recorded.

The server modules live in `src/server/handoff/`, shared types in `src/shared/handoff.ts`, client station modules in `src/client/features/handoff/` and `src/client/shared/handoff/`, and CLI/MCP extensions in `bin/office-handoff-tools.js`. Registry entries connect the feature without placing implementation in the composition roots. Lite's shared station module imports no three.js.
