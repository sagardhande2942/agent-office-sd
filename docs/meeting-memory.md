# Shared memory for meeting teams

Custom meetings with `memory: true` use the floor's existing Knowledge store. Other meetings retain their existing behavior and tool restrictions. It works through the same host-local services and authenticated worker hooks on local and remote floors. Update Office and the floor host together.

## Session context

Before any participant is hired, the server snapshots a bounded set of pinned/relevant note summaries and their exact versions. The same digest-labelled packet is appended to every participant's initial brief. Later edits do not silently change that packet; another session receives updated summaries. Bodies and other notes remain available through `knowledge_index`, `knowledge_read` and `knowledge_search`.

Hints exclude archived and needs-verification notes. An unverified observation can still be explicitly searched/read and stays labelled unverified. These are historical claims, not trusted task instructions or proof of factual correctness. This is shared floor memory: it does not provide confidential data separation.

`bootstrapBudgetChars` and `hintCount` bound the summary packet. With a small budget, compact tool/review instructions replace detailed instructions and fewer hints are delivered. Note bodies are not injected. Policy is captured when the packet is created, so changing reviewPolicy affects later sessions rather than bypassing an active session's required review.

## Roles and writes

The server checks the authenticated worker against current, running meeting membership before and after reading a request. A finished/departed worker cannot reuse its token for meeting Knowledge access.

- Every active participant can read/search the shared tree.
- Only its chair can create/edit notes under `meetings/observations/MEETING_ID/` and record the session review.
- Other meetings' observations and general Knowledge notes are read-only to this chair. Move/archive operations are unavailable.
- Observation writes force `status: needs-verification`, disable pinning, and remove submitted verification claims. Read before editing and pass `expectedVersion`; stale writes fail normally.
- Keep each observation scoped: what happened, supporting artifact/version references, limits and counterexamples. Recording a note does not verify its evidence.

For example, the chair calls `office-workers knowledge write` with JSON on stdin containing `path`, `frontmatter`, `body`, and `expectedVersion` (null for a new note). Read the actual meeting ID from the session instructions. Curating/promoting these observations into general lessons uses existing separate Knowledge review/publication, not a meeting's permission to mark facts verified.

## Completion review

After writing BOTH final JSON and the companion readable report, the chair calls:

```sh
office-workers knowledge review <<'JSON'
{"changed":[],"none_reason":"No supported durable lesson beyond the supplied evidence"}
JSON
```

If observations were written, supply their paths in `changed` instead. The API derives meeting/chair identity from authentication; callers cannot select another meeting. It records the packet digest, exact output/report digest and changed-note versions. The default required policy holds completion until this receipt matches. Later output or note changes require a new review. A viewer's Finish anyway communication override cannot bypass it.

If the chair ends the final turn without reviewing, the room shows a Knowledge blocker and delivers one follow-up when the chair is available. Restart preserves pending review and receipts. Required review is session-level, separate from ordinary worker completion checklists. Prompt/off policies do not block completion; instructions still explain memory use. No Knowledge PR is required to finish the meeting session.

A session restored from before memory support captures its first packet at the review checkpoint and labels that recovery explicitly. Storage/configuration/lock errors hold completion with a visible blocker; they must not terminate the meeting timer. Preserve original outputs while repairing a blocker. A stopped meeting still follows existing stop/new-session semantics.

## Persistence and limits

Per-session records live in the configured Knowledge root under `_meta/state/meeting-memory-<hashed-id>.json`. This avoids scanning one growing global packet map. Snapshot/review copies are also written into the meeting's notes for its normal archive. Include Knowledge state, meeting state, worktrees and original artifacts in backups. The existing meeting archive remains best-effort; these receipts are not an immutable evidence database. Session state/observation retention requires an operator policy; no automatic deletion is introduced.

Shared-memory review records what participants checked. It does not approve a domain decision or choose the next task; those responsibilities belong to the caller.

## Verification

`tests/meeting-memory.test.ts` exercises shared/frozen context, current note versions, evidence review binding, policy, authenticated role/path restrictions and stale writes. The real MeetingRoom regression covers required review, restart and communication override. Existing ordinary Knowledge and meeting-space/remote tests remain in the focused checks. Fixtures use no paid agents or external services.

Restoring a frozen memory packet also recreates its `knowledge-context.json` archive when the session's notes directory becomes available. Recovery uses the original packet and digest; it does not refresh hints or alter the output-bound review.
