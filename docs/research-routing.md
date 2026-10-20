# Continuous team queues: Office dispatcher

The opt-in dispatcher connects research meeting spaces to `tradeai-x-office` department queues. The Python coordinator owns candidate state, immutable revisions, backtests, evidence and budgets; Office owns meetings, Knowledge access, participants and seat cleanup. Existing Boss code-delivery activities are unchanged. This phase is a local routing foundation, not a new Boss console/activity UI.

## Configure a local floor

Install the compatible middleware queue service and initialize its activity with this floor's actual ID. Start its authenticated loopback bridge as described in that repository's `docs/team-queues.md`. Keep the same token in the Office server environment:

```sh
export AGENT_OFFICE_RESEARCH_BRIDGE_TOKEN='<private random value of at least 32 characters>'
```

Create `<floor>/.agent-office/research-routing.json` manually, untracked by Git and owned by the Office process user with mode 600:

```json
{
  "enabled": true,
  "endpoint": "http://127.0.0.1:8765/research/v1/",
  "tokenEnv": "AGENT_OFFICE_RESEARCH_BRIDGE_TOKEN",
  "maxMeetings": 2
}
```

If Office accounts are enabled, add owner with the initiating administrator's real account ID. Its current authorization is checked before claims and again before spawning. Configure existing installed/signed-in provider defaults; permission/input prompts remain real blockers. Restart Office after changing this config. The file alone is not a sandbox against agents with unrestricted host filesystem access; use trusted executables.

No config, disabled config, missing credentials, committed/public-readable config or stale controller lock means no new routed agent work. Token variable names must start AGENT_OFFICE_; Office's child environment scrubber removes those controller credentials. Do not include tokens in agendas or shared Knowledge.

Autonomous dispatch currently requires a local POSIX Git floor with current local admin authorization. Hosted floors cannot dispatch through this path because they require renewable Office authorization/capacity grants. The dispatcher explicitly refuses instead of bypassing those grants. Remote meetings and their shared-memory tools retain their existing manual operation.

## Behavior

Every five seconds, a bounded non-overlapping round reconciles prior attempts, posts results, renews claims, and takes eligible tasks if whole-meeting capacity is available. Each department gets a persistent space ID. Room renames do not change the assignment. Whole-meeting seat requirements and the existing building/provider budgets still apply. maxMeetings bounds routed work, not total building seats; discovery normally needs four seats, most other departments three.

Before each meeting, the controller persists claim/start intent and the server-assigned execution key. Meeting IDs are derived from that key, and routingKey is saved with the meeting/archive. Uncertain starts are held for reconciliation and never automatically replayed. It reattaches to observable meetings after restart. Lease expiry does not authorize a different meeting.

After required memory review and structured completion, Office sends the exact report to middleware. For build-ready results, it collects inline source or reads source_path only within that meeting worktree, checks SHA-256/size, and transfers content. Source is also copied into the meeting archive. Only after acknowledgment does the router clear the finished room and retire its participants, preserving normal archives/branches. This releases seats for the next department. A lost acknowledgment retries the saved result even if a user cleared the room in between.

Task context includes current revision/protocol, current run evidence and references to earlier meeting outputs. Large artifacts remain explicit file reads rather than whole-history prompt injection. Oversized agendas/results are refused. Ready polls can stage/reconcile development backtests through the existing middleware Loop; the ordinary middleware supervisor excludes team-owned cycles to avoid duplicate agent routing.

The pipeline concludes with review_complete or a visible blocker, not strategy acceptance. Development results are not independent holdout evidence or verified portfolio analytics. Paper-review recommendations do not start paper/live execution. Those scientific/execution capabilities remain separate gates.

## Recovery and status

Private local files:

- `.agent-office/research-routing-state.json`: attempts, saved claims/results, backoff and errors. Contains secrets; do not publish it.
- `.agent-office/research-departments.json`: durable department-to-space IDs.
- `.agent-office/research-routing.lock`: exclusive controller marker.

Orderly shutdown releases the lock after any pending poll finishes. A hard crash leaves it: confirm the previous controller is stopped before manually removing the empty lock directory and restarting. Never remove an active controller's lock. Corrupt state is preserved and disables the service. Unknown start outcomes remain unresolved even after restart. Inspect sessions/archives first; do not erase state to force another execution.

Per-attempt transport errors use capped backoff with the same identities. Finished attempts retain only a bounded local history; durable research results remain in middleware. Use its `pipeline status`, pause/drain/resume and bounded retry commands for workflow controls. Retry is permitted only for a known completed/stopped blocker, not active or ambiguous work.

## Verification

Run npm run typecheck, npm test and npm run build. Focused tests cover lost claim/start/result responses, changed identities, unresolved starts, revoked authorization, endpoint restrictions, private env scrubbing, exclusive locks and source-path/digest checks. Run the cross-repository fixture:

```sh
RESEARCH_OFFICE_TEST_ROOT=/absolute/tradeai-x-office \
  node --import tsx scripts/e2e-research-routing.mjs
```

It launches a real authenticated Python bridge and real Office meeting/memory engines with scripted workers. No paid model calls or live trading services are used. The middleware suite separately exercises all departments through the staged fake-Runner subprocess. Real providers, real shared mounts and actual Orca execution still require an operator-configured pilot.
