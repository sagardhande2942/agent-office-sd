import type { WorkerInfo, WorkerStatus } from './protocol/workers.js';

export const BOSS_PROMPT_MAX = 2000;
export interface BossGuard { floor: string; createdAt: number; status: WorkerStatus }

export function validBossPrompt(text: string): boolean {
  return !!text.trim() && text.length <= BOSS_PROMPT_MAX && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

/** Same rule at the UI and at the session that ultimately receives a guarded prompt. */
export function bossEligible(w: WorkerInfo): boolean {
  return w.kind === 'agent' && !w.helper && !w.meeting && !w.lost && !w.deskId.startsWith('station-') && ['idle', 'done', 'working'].includes(w.status);
}

export function validBossGuard(w: WorkerInfo, guard: unknown): guard is BossGuard {
  if (!guard || typeof guard !== 'object') return false;
  const g = guard as Record<string, unknown>;
  return typeof g.floor === 'string' && !!g.floor && Number.isFinite(g.createdAt) && g.createdAt === w.createdAt && g.status === w.status && bossEligible(w);
}
