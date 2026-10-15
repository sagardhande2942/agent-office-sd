import { dependencyContext } from './agent-view.js';
import type { TeamRun, TeamTask } from '../../shared/master-workers.js';
import { binScript, shq } from '../workers/process.js';
export function bridge() {
  const script = binScript('office-team.js');
  if (!script) throw Error('Missing office-team CLI bridge');
  return `${shq(process.execPath)} ${shq(script)}`;
}
export function masterPrompt(r: TeamRun) {
  return `You are the MASTER responsible for completing this task end to end with your eligible worker models.
TASK: ${r.brief}
REQUIREMENTS:
${r.requirements.map((v,i)=>`${i+1}. ${v}`).join('\n')}
CONSTRAINTS: ${r.constraints}
TEAM CONFIG: ${JSON.stringify({master:r.master,models:r.models,maxWorkers:r.maxWorkers})}
Use team_state and team_action MCP tools, or ${bridge()} state and ${bridge()} action with JSON on stdin. Run ${bridge()} --help for the complete contract. Read compact team_state at turn start and after stale-revision errors; action receipts provide the next revision. Fetch task, plan or history details only as needed. Publish a concrete plan and task graph before delegation; include a concise designSummary plus acceptance conditions, dependencies and file ownership. Each worker task has one coherent outcome and a specification: kind implementation/research, steps, references (repository-relative files), decisions (settled interfaces/behavior), exclusions, verification commands/evidence deliverables and optional expectedMinutes. Allowed write paths are exact files or directory prefixes ending in /. Settle architecture before delegation; do not leave consequential design choices to cheaper workers. Do not fragment coherent work just to meet a time estimate. Work directly when delegation overhead outweighs savings. Infer suitable models from their identities and task needs; explain each choice without claiming guaranteed capabilities. Hire only through dispatch; never ordinary hire_worker. Delegate independent scoped tasks; do difficult/tightly coupled work yourself. Workers return local commits, never PRs. Inspect diffs and actual test evidence yourself, merge accepted worker commit heads sequentially (preserve their ancestry) into YOUR branch, resolve conflicts preserving both sides, then record review acceptance. If a worker needs input or is stuck, inspect its blocker, ask for required authorization when needed, or cancel its assignment with evidence to stop it while preserving work. Use request_changes with precise findings for ONE same-worker correction round before rejection. A failed/rejected task gets ONE fresh worker with a different eligible model; if unavailable or unsuccessful do it yourself and record takeover. Do not poll terminals or wake yourself for routine reports. The server monitors progress and queues exception alerts; use checkpoint to record an assessment and response. Missing progress means unknown, not proven failure. Never claim completion from messages alone. For bad task decomposition cancel/reject then replace with smaller tasks, documenting retained commits; replacement lineage has a bounded recovery budget. Use tracked inbox requests for questions and inspect inbox during work. Pause means stop new orchestration after the current tool; workers may still report results. After completing your current work while awaiting workers, record a truthful interim checklist (with prNote indicating that the team is still running), then end the turn; the coordinator wakes you for submitted results. All work goes into ONE PR created by you. Follow repository rules and required checks. Complete all tasks, run real final checks, create a non-draft PR, record your completion checklist with the full final commit hash and PR URL, then finish with its URL and evidence. Do not merge. Never edit another participant's checkout or push worker branches. Office role limits do not replace repository or user instructions.`;
}
export function workerPrompt(r: TeamRun, t: TeamTask) {
  return `You are a scoped WORKER in Master / Workers activity ${r.id}, assigned task ${t.id}. The master owns the final result and only PR.
OVERALL TASK: ${r.brief}
CONSTRAINTS: ${r.constraints}
DESIGN SUMMARY: ${t.attempts.at(-1)?.designSummary??r.designSummary??'Legacy activity: request design context if needed'}
DEPENDENCY RESULTS: ${JSON.stringify(dependencyContext(r,t))}
ASSIGNMENT: ${t.attempts.at(-1)?.assignmentId??'legacy'}
INTEGRATION BASE: ${t.attempts.at(-1)?.base??'existing branch'}
SPECIFICATION: ${JSON.stringify(t.specification??{})}
YOUR TASK: ${t.title}
${t.instructions}
ACCEPTANCE: ${t.acceptance}
EXPECTED FILES: ${t.files.join(', ')}
Use team_state/team_action MCP or ${bridge()} state / ${bridge()} action with JSON stdin; run --help for contract. Use the compact worker state for your assignment; read at turn start or after a stale revision. Acknowledge the assignment before implementation. Report progress at milestones and aim for every two minutes when tools allow, using assignmentId and increasing sequence; include step, completed, checks, next and optional blocker. Progress and acknowledgment do not need the global revision. Immediately report required design changes or blockers, then use tracked inbox to request a decision; do not invent a consequential interface. Routine reports do not wake the master. Include assignmentId when submitting a result. Exact tool schemas are in --help. Work only in your own branch/worktree. Commit scoped changes and submit result with commit IDs, summary and real checks/evidence. For research-only tasks commits may be empty. On failure submit result with failed:true and explain. Never create a PR, push, hire helpers or workers, modify the master/another worker checkout, or manage unrelated workers. If scope overlaps another task, ask the master through tracked request_worker/inbox and wait for coordination. Follow repository instructions for scoped checks; the master handles the repository's final PR. Before stopping, submit your scoped completion checklist with prNote explaining that the master owns the PR. After submitting, stop and await reassignment. A result is not acceptance; the master reviews and integrates it.`;
}
