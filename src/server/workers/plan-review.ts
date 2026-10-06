import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { DeskDef } from '../../shared/layout.js';
import type { WorkerInfo, WorkerKind } from '../../shared/protocol.js';
import type { PlanReviewWorker } from '../../shared/plan-review.js';
import type { WorkerContext, Worker } from './types.js';
import { clockWork } from './clock.js';
export function planningVersion(info: Pick<WorkerInfo, 'planReview' | 'provider'>, command: string): string | undefined {
  if (!info.planReview?.locked || info.provider !== 'opencode') return;
  try { if (!/^1\./.test(execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim())) return 'Read-only planning currently requires OpenCode 1.x'; } catch { return 'OpenCode 1.x must be installed for this candidate'; }
}
export function planningSeat(seat: DeskDef, role: PlanReviewWorker | undefined, kind: WorkerKind, worktree: boolean, provider: WorkerInfo['provider'], model: string | undefined, mcp: string | undefined, command: string): string | undefined {
  if (!!seat.review !== !!role) return 'Only a plan comparison seats workers at its table';
  if (role && (kind !== 'agent' || !worktree || !role.locked || !['claude', 'opencode'].includes(provider ?? '') || !model || !mcp)) return 'Planning requires an explicit Claude/OpenCode model, an independent worktree and office MCP tools';
  return planningVersion({ planReview: role, provider }, command);
}
export function promotePlanWorker(ctx: WorkerContext, id: string, activityId: string, prompt: string, launch: (w: Worker, prompt: string) => void): string | undefined {
  const w = ctx.workers.get(id);
  if (!w || w.info.planReview?.id !== activityId || w.info.planReview.role !== 'candidate') return 'Selected worker is not this activity’s candidate';
  if (!w.info.planReview.locked) return ['offline', 'exited'].includes(w.info.status) ? 'Selected worker is not running; resume its terminal to implement the accepted plan' : undefined;
  const old = w.pty; w.pty = undefined; old?.kill();
  w.info.planReview.locked = false; w.info.sessionId = undefined; w.info.prompt = prompt;
  w.hookToken = randomBytes(16).toString('hex');
  clockWork(w.info, 'starting'); w.info.status = 'starting'; w.info.exitCode = undefined; w.interrupted = false;
  ctx.notePrompt(w, prompt); ctx.persist(); launch(w, prompt);
  return w.info.status === 'exited' ? 'Winner could not start; resume its terminal to implement the accepted plan' : undefined;
}
