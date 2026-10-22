# Custom meeting workflows

Office provides generic scheduling, seats, worktrees, Knowledge access and durable task routing. A caller supplies a declarative workflow: its identity/version, label, brief, roles, stages and result contract. No domain teams or lifecycle decisions are built into Office.

Choose **Custom workflow** in any meeting space and edit its JSON definition, or supply `pattern: "custom"` and `workflow` through the existing authenticated meeting-start message. The server validates and snapshots the definition before hiring. Local and remote hosts need compatible versions; active meetings restore their saved definition rather than rereading a mutable template.

Example:

```json
{
  "id": "docs.review", "version": 1, "label": "Document review",
  "brief": "Review the supplied document and preserve disagreement.",
  "roles": ["Chair", "Reviewer"], "memory": true,
  "stages": [
    {"label":"Assessment","turns":[{"seats":"all","prompt":"As {{role}}, assess the task independently."}]},
    {"label":"Synthesis","turns":[{"seats":[0],"output":true,"prompt":"Read {{notes_1}} and summarize findings."}]}
  ],
  "result": {"rules":[{"path":"summary","type":"string"}]}
}
```

Definitions allow 1–5 roles, 1–8 stages, at most one turn per seat per stage, and exactly one final output turn by seat 0. Stages run sequentially; their assigned participants run concurrently. Names may be customized without changing seat ownership. A stage cannot call tools or execute server code. Provider permissions and existing hiring/capacity budgets still apply; all agents share a checkout, so prompt instructions are not a filesystem sandbox.

Templates support `{{cwd}}`, `{{notes}}`, `{{output}}`, `{{report}}`, `{{meeting_id}}`, `{{workflow_id}}`, `{{workflow_version}}`, `{{role}}`, `{{round}}`, `{{note_R_S}}` (one-based round and seat) and `{{notes_R}}` (all seat note paths for a round). Nonparticipants do not have notes for that stage. Unknown variables are refused. The controller appends the assigned note path, or final result/report instructions, to each prompt.

Final output is JSON plus a nonempty readable companion at `<output>.md`, capped at 256 KiB each. `result.rules` contains dot-path requirements with types `string` (nonempty), `strings` (unique nonempty strings), `object`, `integer`, or `value` (non-null, nonblank). Optional `equals`, string `enum`, string-array `minItems`, and conjunctive `when` field-equality conditions express structural checks. `equals: "{{meeting_id}}"` binds a field to the current session. Missing required values hold completion; the chair receives at most two correction turns without repeating specialist work. Communication overrides cannot bypass validation. These checks do not establish the truth of a caller's conclusions.

Optional `result.attachments` declares UTF-8 file transfers:

```json
{"path":"document.path","content":"document.text","sha256":"document.digest","maxBytes":200000,"when":{"outcome":"ready"}}
```

The output may provide inline content or a path inside its own checkout. Office checks the declared SHA-256, size, encoding and real path (including symlinks), then inserts content into the declared output field. The resolved JSON also has a 256 KiB limit. Field paths cannot access prototype properties. Checked inline content and the workflow snapshot are saved with the normal meeting archive; original paths are never followed from an archive. Archive copying remains best-effort: keep original artifacts until confirmed.

Set `memory: true` to enable [meeting shared memory](meeting-memory.md). Use the optional [task router](task-routing.md) to connect a caller-owned queue. Decisions about what task follows, retries, domain evidence or acceptance remain with that caller.

Verify with typecheck, the full test suite and build. `scripts/e2e-custom-meetings.mjs` checks the actual client/server form and authenticated meeting memory using idle fixtures, without paid providers.

Reviewed JSON and readable reports are archived without reformatting. Attachment-expanded results use a separate `resolved-output-*` sidecar; the original files remain the byte-level evidence for the Knowledge review. Generic routed input snapshots and their bounds are documented in [task routing](task-routing.md#predecessor-artifact-handoff).


## Conditional stages and final-output corrections

A nonfinal stage may include `"when":{"round":1,"seat":1,"field":"needs_changes","equals":true}`. Round numbers are one-based; seat indexes are zero-based. The referenced seat must participate in an earlier unconditional stage and write its assigned note as JSON. A matching typed value runs the stage; a nonmatching value skips it without prompting workers. Missing, malformed, mistyped, oversized or escaped notes stop the session. The final chair output is always unconditional. This is declarative equality checking, with no executable conditions.

If a custom final result, companion report or attachment fails validation, Office reuses the chair for at most two correction turns. Completed assessments stay intact. Attempts and the invalid output fingerprint persist across restart; unchanged files and repeated finish requests cannot consume another attempt. Exhausted corrections stop the meeting with the validation error. Corrected bytes require a fresh output-bound Knowledge receipt; communication gates still apply. Corrections address the output contract and do not authorize a caller to weaken its substantive evidence requirements.

Single-role definitions also power generic [routed desk tasks](task-routing.md#individual-desk-tasks), without reserving physical meeting spaces.
