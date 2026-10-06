import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { DeskDef } from '../../shared/layout.js';
import type { WorkerInfo, WorkerKind } from '../../shared/protocol.js';
import type { PlanReviewWorker } from '../../shared/plan-review.js';
import type { WorkerContext, Worker } from './types.js';
import { isAgentProvider, takesModel } from '../../shared/providers.js';
import { binScript, shq } from './process.js';
import { clockWork } from './clock.js';
export function planningVersion(info: Pick<WorkerInfo, 'planReview' | 'provider'>, command: string): string | undefined {
  if (!info.planReview?.locked || info.provider !== 'opencode') return;
  try { if (!/^1\./.test(execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim())) return 'Read-only planning currently requires OpenCode 1.x'; } catch { return 'OpenCode 1.x must be installed for this candidate'; }
}
export function planningSeat(seat: DeskDef, role: PlanReviewWorker | undefined, kind: WorkerKind, worktree: boolean, provider: WorkerInfo['provider'], model: string | undefined, mcp: string | undefined, command: string): string | undefined {
  if (!!seat.review !== !!role) return 'Only a plan comparison seats workers at its table';
  if (role && (kind !== 'agent' || !worktree || !role.locked || !isAgentProvider(provider) || !takesModel(provider) || !model || !mcp)) return 'Planning requires an explicit provider model, an independent worktree and office MCP tools';
  return planningVersion({ planReview: role, provider }, command);
}
export function promotePlanWorker(ctx: WorkerContext, id: string, activityId: string, prompt: string, launch: (w: Worker, prompt: string) => void): string | undefined {
  const w = ctx.workers.get(id);
  if (!w || w.info.planReview?.id !== activityId || w.info.planReview.role !== 'candidate') return 'Selected worker is not this activity’s candidate';
  if (!w.info.planReview.locked) return ['offline', 'exited'].includes(w.info.status) ? 'Selected worker is not running; resume its terminal to implement the accepted plan' : undefined;
  const old = w.pty, acp = w.dsh; w.pty = undefined; w.dsh = undefined; acp?.close(); old?.kill();
  w.info.planReview.locked = false; w.info.sessionId = undefined; w.info.prompt = prompt;
  w.hookToken = randomBytes(16).toString('hex');
  clockWork(w.info, 'starting'); w.info.status = 'starting'; w.info.exitCode = undefined; w.interrupted = false;
  ctx.notePrompt(w, prompt); ctx.persist(); launch(w, prompt);
  return ctx.workers.get(id)?.info.status === 'exited' ? 'Winner could not start; resume its terminal to implement the accepted plan' : undefined;
}

/** Every CLI can invoke the same authenticated, role-scoped tools without needing an MCP plugin. */
export function planningPrompt(info: Pick<WorkerInfo, 'planReview' | 'provider'>, prompt: string | undefined): string | undefined {
  if (!info.planReview?.locked || !prompt || ['claude', 'opencode', 'codex'].includes(info.provider ?? '')) return prompt;
  const script = binScript('office-plan.js');
  if (!script) throw Error('Office planning bridge is missing');
  const command = [process.execPath, script].map(shq).join(' ');
  return prompt + '\n\nPLAN TOOL ACCESS: Use native plan tools if available. Otherwise invoke ' + command + ' --help to read your role-specific JSON schemas. Read state with ' + command + ' plan_review_state. Submit the full tool argument JSON on stdin to ' + command + ' submit_candidate_plan (candidate), request_plan_clarification or submit_plan_review (reviewer). Use a shell pipe or heredoc; do not create submission files. These commands authenticate using your inherited office environment. Never print credentials. Office management tools are blocked until implementation starts. Repository reads and these plan commands are your only authorized actions; do not run builds, tests or other commands that change the checkout.';
}
