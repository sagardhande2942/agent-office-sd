import { planModelIdentity } from '../../shared/plan-providers.js';
import type { TeamRequest, TeamRun, TeamTask } from '../../shared/master-workers.js';
import type { AgentChoice } from '../../shared/protocol.js';
import { recordEvent } from './recorder.js';
import { recordedText, shorten } from './sanitize.js';

type TaskDef = Pick<TeamTask, 'id' | 'title' | 'instructions' | 'acceptance' | 'files' | 'dependencies'>;

function modelOf(choice: AgentChoice): string {
  return `${planModelIdentity(choice.provider, choice.model)}${choice.effort ? ` @ ${choice.effort}` : ''}`;
}

export function recordStart(run: TeamRun, req: TeamRequest) {
  const instructions = [`Brief: ${req.brief}`, 'Requirements:', ...req.requirements.map((r) => `- ${r}`), `Constraints: ${req.constraints?.trim() || 'none'}`].join('\n');
  return recordEvent(run, { type: 'start', participantId: run.masterId, summary: `Activity started: ${shorten(req.brief)}`, details: { instructions } });
}

export function recordPlan(run: TeamRun, plan: string, tasks: TaskDef[]) {
  const definitions = JSON.stringify(tasks.map((t) => ({ id: t.id, title: recordedText(t.title).text, instructions: recordedText(t.instructions).text, acceptance: recordedText(t.acceptance).text, files: t.files.map(f => recordedText(f).text), dependencies: t.dependencies })));
  return recordEvent(run, { type: 'plan', participantId: run.masterId, summary: `Plan published with ${tasks.length} task${tasks.length === 1 ? '' : 's'}`, details: { instructions: plan, message: `Task definitions: ${definitions}` } });
}

export interface ReplayDispatch {
  task: TaskDef;
  workerId: string;
  attempt: number;
  choice: AgentChoice;
  reason: string;
}

function dispatchDetails(info: ReplayDispatch) {
  return {
    instructions: info.task.instructions,
    message: [`Attempt: ${info.attempt}`, `Model: ${modelOf(info.choice)}`, `Reason: ${info.reason}`, `Acceptance: ${info.task.acceptance}`, `Files: ${info.task.files.join(', ') || 'none'}`, `Dependencies: ${info.task.dependencies.join(', ') || 'none'}`].join('\n'),
  };
}

export function recordAssignment(run: TeamRun, info: ReplayDispatch) {
  return recordEvent(run, { type: 'assignment', participantId: info.workerId, taskId: info.task.id, summary: `Task ${info.task.id} assigned to ${info.workerId} on ${modelOf(info.choice)}`, details: dispatchDetails(info) });
}

export function recordRetry(run: TeamRun, info: ReplayDispatch) {
  return recordEvent(run, { type: 'retry', participantId: info.workerId, taskId: info.task.id, summary: `Retry attempt ${info.attempt} for task ${info.task.id} on ${modelOf(info.choice)}`, details: dispatchDetails(info) });
}

export interface ReplayResult {
  task: { id: string; instructions?: string };
  workerId: string;
  summary: string;
  checks: string;
  commits: string[];
  failed: boolean;
}

export function recordResult(run: TeamRun, info: ReplayResult) {
  return recordEvent(run, {
    type: 'result',
    participantId: info.workerId,
    taskId: info.task.id,
    summary: info.failed ? `Task ${info.task.id} result reported as failed by ${info.workerId}` : `Task ${info.task.id} result submitted by ${info.workerId}`,
    details: { instructions: info.task.instructions, evidence: info.summary, reportedChecks: info.checks, commits: info.commits },
  });
}

export interface ReplayBlocker {
  task: { id: string };
  workerId?: string;
  summary: string;
  message?: string;
  evidence?: string;
}

export function recordBlocker(run: TeamRun, info: ReplayBlocker) {
  return recordEvent(run, { type: 'blocker', participantId: info.workerId, taskId: info.task.id, summary: info.summary, details: { message: info.message, evidence: info.evidence } });
}

export interface ReplayReview {
  task: { id: string };
  workerId?: string;
  outcome: 'accepted' | 'rejected' | 'takeover';
  reason: string;
}

export function recordReview(run: TeamRun, info: ReplayReview) {
  const summary = info.outcome === 'accepted' ? `Result accepted for task ${info.task.id}` : info.outcome === 'rejected' ? `Result rejected for task ${info.task.id}` : `Master took over task ${info.task.id}`;
  return recordEvent(run, { type: 'review', participantId: info.workerId, taskId: info.task.id, summary, details: { reviewReason: info.reason } });
}

export interface ReplayIntegration {
  task: { id: string };
  workerId?: string;
  commits: string[];
  verified: string;
}

export function recordIntegration(run: TeamRun, info: ReplayIntegration) {
  return recordEvent(run, { type: 'integration', participantId: info.workerId, taskId: info.task.id, summary: `Task ${info.task.id} integrated into the master branch`, details: { commits: info.commits, verifiedChecks: info.verified } });
}

export function recordControl(run: TeamRun, kind: 'pause' | 'resume' | 'stop', message?: string) {
  const summary = kind === 'pause' ? 'Activity paused' : kind === 'resume' ? 'Activity resumed' : 'Activity stopped';
  return recordEvent(run, { type: kind, participantId: run.masterId, summary, details: { message } });
}

export function recordRecovery(run: TeamRun, error: string) {
  return recordEvent(run, { type: 'pause', participantId: run.masterId, summary: 'Recovered after an office restart; activity paused for reconciliation', details: { message: error, missing: ['activity events recorded while the office was down'] } });
}

export interface ReplayFinalPr {
  pr: string;
  summary: string;
  checks: string;
  verified: string;
}

export function recordFinalPr(run: TeamRun, info: ReplayFinalPr) {
  return recordEvent(run, { type: 'final-pr', participantId: run.masterId, summary: `Final PR recorded: ${shorten(info.pr, 200)}`, details: { pr: info.pr, evidence: info.summary, reportedChecks: info.checks, verifiedChecks: info.verified } });
}
