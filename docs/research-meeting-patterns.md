# Research meeting patterns

Open a Meeting space/reality, choose a research pattern, supply the specific question and evidence references, edit participant roles if desired, and start. These workflows use existing local/remote meeting spaces and capacity rules. They hire meeting participants and continue when another reality is selected. No PR number is required and no forge review is posted by a research pattern.

| Pattern | Default participants | Stages |
| --- | --- | --- |
| Edge discovery | Chair, mechanism researcher, data researcher, skeptic | Independent assessment → challenge → synthesis |
| Experiment design | Research lead, data specialist, experiment designer | Independent assessment → challenge → synthesis |
| Strategy build | Technical lead, implementation engineer, correctness reviewer | Planning → implementation → independent review → synthesis |
| Backtest investigation | QA lead, data auditor, execution analyst | Independent assessment → challenge → synthesis |
| Validation council | Independent chair, statistical reviewer, robustness reviewer | Independent assessment → challenge → synthesis |
| Portfolio review | Risk chair, exposure analyst, portfolio researcher | Independent assessment → challenge → synthesis |
| Research retrospective | Curator, evidence reviewer | Independent assessment → challenge → synthesis |

Stages are fixed and bounded. Existing editable roles, agenda, output path and provider choices still apply. This is the first installed pattern set, not an arbitrary workflow editor or saved team-template system. Keep independent-review roles distinct when customizing seats. All participants share a worktree: independence and single-writer file ownership are instructions, not an OS security boundary.

Strategy build assigns planning to the lead, sole code implementation to the engineer, review to the reviewer and synthesis to the lead. Only the engineer writes source within the lead's planned scope. Other patterns write notes/reports, not strategy code. Prompts prohibit unapproved experiment submission and live trading. Use trusted agents and existing provider permissions; prompts are not a sandbox.

## Inputs and output

Supply exact candidate/revision/specification and accessible evidence in the agenda. The pattern does not assume an automatically delivered memory packet. Participants may use existing authenticated Knowledge tools where available; the regular worker Knowledge bootstrap/completion gate still excludes meeting agents. Dedicated memory and continuous pipeline integration are subsequent changes.

Default output is `docs/research/<pattern>/<title>.json` and a readable companion `<output>.md`. The chair receives required fields in its final prompt. Example validation result:

```json
{
  "schema_version": 1,
  "meeting_id": "<current meeting ID>",
  "pattern": "research.validation-council",
  "pattern_version": 1,
  "summary": "Required validation artifacts are unavailable",
  "outcome": "blocked",
  "evidence_run_ids": [],
  "findings": ["Request the frozen revision and evaluation results"],
  "dissent": [],
  "next_action": "Supply artifacts before evaluation",
  "details": {
    "revision_id": "Unavailable: request exact revision",
    "protocol_digest": "Unavailable: request frozen protocol",
    "criteria_assessment": "Not evaluated",
    "exposure_limits": "Do not release reserved data without an authorized protocol"
  }
}
```

The server validates version/identity, allowed outcomes, field types, required details, and evidence-ID presence where a verdict needs evidence. Both outputs must exist and are capped at 256 KiB each. Invalid output stops the session with a reason; preserve notes and start a corrected session. A communication override cannot bypass this check. Blocked/inconclusive sessions can finish with explicit missing-input explanations rather than fabricated evidence.

Required detail keys and outcomes live in `src/shared/research-patterns.ts`. Validation is structural: it cannot prove a run ID exists, a source digest is correct, a reviewer actually checked evidence, or a strategy should advance. Those gates belong to `tradeai-x-office`. No automatic Orca submission, research acceptance, task routing, paper execution or live trading is added here.

Pattern version 1 is saved with each session. A running session with an unsupported research version restores stopped with a reason; built-in meetings retain their old format. Notes, JSON and readable output are copied into the existing archive. Its archival operation remains best-effort; it is not an immutable research evidence store. Keep original artifacts until archiving is confirmed.

## Implementation and verification

The room delegates round planning to `src/server/meeting-patterns/index.ts`. Legacy patterns use the compatibility planner and preserve existing prompt IDs. Research planning and completion validation live in dedicated modules. Pattern metadata drives the existing UI and host validation: update Office and floor host together before selecting a new pattern remotely.

Run `npm run typecheck`, `npm test`, `npm run build`, and `node --import tsx scripts/e2e-research-patterns.mjs` with `CHROMIUM_PATH` when needed. Focused tests cover all workflows, structured completion, restart/versioning, space/remote compatibility and size limits. Browser checks use idle fixtures and make no paid model calls.
