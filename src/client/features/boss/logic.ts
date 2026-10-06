import { BOSS_PROMPT_MAX, bossEligible, validBossPrompt } from '../../../shared/boss';
import type { WorkerInfo } from '../../../shared/protocol';
import { tokensOf } from '../../../shared/protocol';

export const MAX_PROMPT = BOSS_PROMPT_MAX;
export const MAX_TARGETS = 50;

/** Shared floor controls never paste prompts into shells, helpers or approval menus. */
export const eligible = bossEligible;

export function findMostIdleWorker(workers: Iterable<WorkerInfo>): WorkerInfo | undefined {
  return [...workers].filter((w) => eligible(w) && w.status !== 'working').sort((a, b) =>
    Number(a.status !== 'idle') - Number(b.status !== 'idle') ||
    (a.lastInput?.at ?? a.waitingSince ?? a.createdAt) - (b.lastInput?.at ?? b.waitingSince ?? b.createdAt) || a.id.localeCompare(b.id),
  )[0];
}

export interface DispatchPlan { floor: string; prompt: string; targets: WorkerInfo[] }

/** Snapshot precisely the recipients shown in the confirmation; never pick new ones on submit. */
export function planDispatch(floor: string | null, prompt: string, workers: Iterable<WorkerInfo>, auto: boolean): DispatchPlan | undefined {
  const text = prompt.trim();
  if (!floor || !validBossPrompt(text)) return;
  const all = [...workers];
  const one = auto ? findMostIdleWorker(all) : undefined;
  const targets = auto ? (one ? [one] : []) : all.filter(eligible);
  if (!targets.length || targets.length > MAX_TARGETS) return;
  return { floor, prompt: text, targets: targets.map((w) => ({ ...w })) };
}

/** If a floor/session/status changed during review, skip it instead of overwriting new input. */
export function dispatchTargets(plan: DispatchPlan, floor: string | null, workers: Map<string, WorkerInfo>): WorkerInfo[] {
  if (floor !== plan.floor) return [];
  return plan.targets.flatMap((before) => {
    const now = workers.get(before.id);
    return now && now.createdAt === before.createdAt && now.status === before.status && eligible(now) ? [now] : [];
  });
}

export function analytics(workers: Iterable<WorkerInfo>) {
  const all = [...workers];
  return { total: all.length, working: all.filter((w) => w.status === 'working').length,
    needs: all.filter((w) => w.status === 'needs_input').length, done: all.filter((w) => w.status === 'done').length,
    tokens: all.reduce((n, w) => n + (w.usage ? tokensOf(w.usage) : 0), 0),
    cost: all.reduce((n, w) => n + (Number.isFinite(w.usage?.cost) ? w.usage!.cost! : 0), 0) };
}
