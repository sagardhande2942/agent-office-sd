# Durable meeting task routing

The optional router connects local meeting spaces to an operator-selected queue service. The service owns task lifecycle, domain rules and budgets. Office owns meeting execution, Knowledge access, seat capacity, result delivery and room cleanup. Existing Boss activities retain their behavior.

## Local configuration

Create `<floor>/.agent-office/task-routing.json`, untracked by Git, owned by the Office process user with mode 600:

```json
{"enabled":true,"endpoint":"http://127.0.0.1:8765/tasks/v1/","tokenEnv":"AGENT_OFFICE_TASK_BRIDGE_TOKEN","maxMeetings":2}
```

Set that environment variable on the Office server and queue service to the same private token (at least 32 characters). `tokenEnv` must start `AGENT_OFFICE_`; existing child-environment filtering removes controller credentials from workers. Never put credentials into agendas or Knowledge. With accounts enabled, add `owner` with the initiating administrator's account ID. Restart after config changes. Installed/signed-in provider defaults, permission prompts and building/provider budgets still apply.

Routing requires a local POSIX Git floor with current local administrator authorization. Hosted autonomous dispatch requires future renewable remote grants and is explicitly refused. Manual remote meetings and memory continue through their existing services. A missing, disabled, tracked or public-readable configuration, unavailable credential or stale lock prevents new routed work.

## Integration contract (version 1)

All routes use bearer authorization and `X-Office-Floor: <floor ID>`. Only loopback HTTP with the exact `/tasks/v1/` base path is accepted; redirects, URL credentials and query/hash components are refused.

- `GET health`: `{schema_version:1,capabilities:["meeting-tasks-v1"]}`.
- `GET ready`: `{tasks:[...]}`. Each task has `id`, monotonic integer `version`, `group`, `title`, `workflow`, `input` and optional `references` (prior meeting IDs). Workflow follows [custom meetings](custom-meetings.md). Group names map to persistent spaces; Office does not interpret their meaning. Input is opaque agenda data.
- `POST claim`: `{task_id,version,dispatcher,claim_key}`. Returns the same task envelope plus `claim_token` and stable `execution_key`. Repeating a claim key must recover the same claim; conflicting ownership/version must fail.
- `POST heartbeat`: `{task_id,token,meeting_id}`. Renews the same claim and attaches its one meeting identity. Expiry must never authorize automatic reassignment of uncertain work.
- `POST complete`: `{task_id,token,result}`. Accept identical repeats, refuse conflicting results. The service validates domain meaning independently. An explicit HTTP 400 is a permanent report rejection; unknown transport outcomes are retried.
- `POST fail`: `{task_id,token,reason}`. Accept identical repeats. Preserve the blocked task for operator action.

Office never requests an operator reset/retry. Queue services decide admission, routing, acceptance and bounded recovery. Keep responses below 2 MiB, individual outputs below 256 KiB and agenda inputs small enough for the 19,000-character brief cap. Reference large artifacts explicitly instead of inserting full history.

## Execution and recovery

A non-overlapping five-second poll reconciles existing attempts before taking work. Before claim/start, Office durably saves intent. It uses the server-assigned execution key to derive a stable meeting ID. Lost responses recover the same identity. A start with an unknown outcome becomes unresolved and is never automatically repeated. Revoked authorization prevents new claims/starts. `maxMeetings` bounds routed attempts; the existing capacity rules must fit an entire team before claiming and again before starting.

Group-to-space IDs survive room renaming. After structured completion and any required memory review, Office durably caches the resolved result before delivery. Only acknowledged completion/failure permits clearing the associated finished room and retiring its participants. Cached delivery survives lost acknowledgments and user-cleared rooms. Current and archived meetings are found by routing identity. Exact reviewed JSON/report bytes are retained as `output-*`; expanded attachment content is saved separately as `resolved-output-*`. Derived results may add only declared, digest-checked attachment fields and cannot change a reviewed decision. A present Knowledge review must match the original bytes before an archived result is reused.

Private files:

- `.agent-office/task-routing-state.json`: attempts, claim secrets, cached results and capped retry backoff. Do not publish.
- `.agent-office/task-groups.json`: durable group-to-space bindings.
- `.agent-office/task-routing.lock`: exclusive controller marker.

Orderly shutdown releases its lock after an active poll finishes. Hard crashes leave it: confirm the prior controller has stopped before manually removing the empty lock directory. Never remove another live controller's lock or erase ambiguous attempt state to force execution. Corrupt/unwritable state holds routing. Inspect sessions and archives before reconciling unresolved work; domain recovery belongs to the queue service. Templates/configuration are trusted operator inputs, not an isolation boundary against arbitrary host processes.

## Verification

Run typecheck, the full suite and production build. Router tests cover lost responses, restart identity, unresolved starts, revoked authorization, endpoint restrictions, credential scrubbing, exclusive locks and attachment boundaries. The generic meeting browser fixture checks form selection and authenticated memory with no paid model calls. Integrations should keep their domain-specific end-to-end fixtures in their own repository.

## Predecessor artifact handoff

Task `references` select completed meetings on the same floor. Before seating participants, Office snapshots their JSON, readable report and available attachment-expanded view into `.meeting/inputs/MEETING_ID/` in the new meeting checkout. `previous_artifacts` contains those checkout-relative paths and SHA-256 values, never paths into another worktree. These are reference data, not executable instructions. Copies remain in the new meeting archive after its worktree is removed.

Reads are bounded to 256 KiB per UTF-8 regular file and 2 MiB across the input bundle. Paths escaping the floor, unsafe identities, missing predecessors, modified reviewed bytes, invalid attachments and symlink destinations stop dispatch rather than silently dropping context. No broader filesystem permissions are granted. The generic room lifecycle stages inputs before launching any participant; invalid inputs cannot launch workers.

Earlier builds reformatted `output-*` when expanding attachments. An old archive whose review no longer matches cannot be automatically certified or reused: preserve it for operator reconciliation. This change does not rewrite old outputs or fabricate new reviews. An archive without a Knowledge receipt retains legacy behavior; a present receipt is always checked. All domain-specific test agendas and evidence policies belong to the calling integration.
