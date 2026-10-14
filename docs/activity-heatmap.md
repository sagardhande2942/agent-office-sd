# Office activity heatmap

Open **Activity heatmap** from Lite’s toolbar, the 2D/3D menu or the command palette. Filter by worker/activity, choose a time window and bucket size, then focus/select a cell for textual durations and activity/task/attempt IDs. The longest phase determines color; intensity reflects recorded duration and ◉ marks live time. Refresh runs every five seconds. Esc or the top-right ✕ restores game controls.

## Phase boundaries

Each worker has at most one phase at a time. Precedence is **waiting for input → review → checks → retry attempt work → implementation → unknown**. Transitions close the preceding interval at the same timestamp; duplicate updates do not restart intervals.

| Phase | Start | End |
| --- | --- | --- |
| Waiting for input | Worker becomes `needs_input` | Resume, removal, suspension or activity pause/end |
| Review | Team attempt submitted and task enters review | Acceptance, rejection, takeover, removal, suspension or activity pause/end |
| Checks | Paired root Claude tool starts a command classified as test/build/typecheck/lint | Matching tool end/failure, turn/session end or higher-priority phase |
| Retry attempt work | Running team attempt numbered 2+ is observed working | Attempt stops/submits, higher-priority phase or activity pause/end |
| Implementation | Paired root Claude/Codex edit tool starts | Matching tool end/failure, turn/session end or higher-priority phase |
| Unknown | Worker observed working without measurable phase boundaries | Measurable phase begins or observed work ends |

Review measures elapsed time associated with a submitted result awaiting review, **not human or master review effort**. Retry duration is retry-attempt work, never an instantaneous milestone; its checks and waits retain their own phases. Non-team identity uses session and completion revision when available; team intervals include activity/task IDs and attempt number. Removed worker IDs remain in history.

## Signals and limitations

Worker lifecycle status supplies wait/work/end observations across providers whose adapters report it. Claude/Codex root hooks measure edit tools when paired `tool_use_id` boundaries exist. Claude command arguments support check classification; Codex compact hooks omit command arguments, so shell checks remain unknown. Reading, browsing, reasoning and generic execution remain unknown. Missing tool IDs cannot establish duration. Child-session signals are excluded. OpenCode, Grok, Muse, Pi, DSH, Cursor, Antigravity, Kilo and custom providers have no measured edit/check boundaries in this recorder; available status is still observed. Plain shell terminals are excluded. Check/result text and terminal output never manufacture phase duration.

Team attempt/submission/review and pause/end transitions are observed directly. A one-second heartbeat reconciles registered sessions. Pausing stops intervals even if a terminal continues running. Resume begins fresh observation without charging the paused gap. Unavailable signals are explained; “no recorded time” does not prove zero actual time.

**Summed worker-time** adds matching intervals. Two workers observed for a minute yield two worker-minutes. **Observed wall time** unions intervals across workers, yielding one minute in that example. Both include unknown observed phases and exclude restart downtime. Neither represents complete project effort.

## Persistence and coverage

Each floor atomically replaces `.agent-office/activity-heatmap.json` with private file permissions. Retention is at most 2,000 intervals/seven days plus 100 restart gaps. The window shows observation start/last observation, partial historical coverage, dropped intervals and downtime gaps. Earlier replay-only history is never reconstructed; age-clipped history remains partial. Blank buckets mean missing evidence, not idle time.

Every second a heartbeat checkpoints observed time. Restart closes persisted live intervals at that checkpoint and excludes downtime until fresh observations arrive. This conservatively loses the uncheckpointed tail. Removal, suspension and graceful shutdown close intervals. Only bounded structured identities, phases and timestamps are stored; no prompts, terminal streams, commands, secrets, model calls or responses. Updated connected floor hosts support the read endpoint; older/disconnected hosts show unavailable history.

Verify with `npm run typecheck`, `npm test`, `npm run build`, then `node --import tsx scripts/e2e-activity-heatmap.mjs`. The browser harness uses a real server, temporary floors, synthetic persisted intervals and a local lifecycle fixture process, with no model calls. Screenshots/assertions go to `/tmp/agent-office-activity-heatmap-evidence`; override with `HEATMAP_ARTIFACTS`, and choose Chromium with `CHROMIUM_PATH`.
