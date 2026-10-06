// The floor as one manager sees it: every worker with its task, status and what's stopping it, every
// task on the queue with the agent it will start on and whether its work is verified, and what needs a
// person. One pure builder (`managerReport`) serves `office-workers status`, the read-only MCP tool
// `floor_status` and the office's nudge to the Manager agent (see server.ts).

import type { GhPull, QueueTask, WorkerInfo } from './protocol.js';
import type { Blocker, WorkerRow } from './status.js';
import { alertDetail } from './status.js';

export type { Blocker } from './status.js';

/** How long a worker may go without writing to its terminal before the office calls it stalled. */
export const STALL_MS = 10 * 60_000;

/** A worker as the manager sees it: the row `office-workers list` shows, plus the task it was given. */
export interface ManagerWorker extends WorkerRow {
  /** The queue task it was seated for, when it holds one. */
  taskId?: string;
}

/** Where a finished task's work stands: a pull request with its checks, or nothing to show yet. */
export type Verdict = 'verified' | 'needs-review' | 'unverified';

/** One task on the queue as the manager sees it: who runs it, on what, and how it stands. */
export interface ManagerTask {
  id: string;
  title: string;
  status: QueueTask['status'];
  outcome?: QueueTask['outcome'];
  issue?: number;
  /** The agent the task will start on, as it was queued. */
  agent: { provider?: QueueTask['provider']; model?: string; effort?: QueueTask['effort'] };
  addedBy: string;
  /** The worker seated for it. */
  workerId?: string;
  workerName?: string;
  startedAt?: number;
  finishedAt?: number;
  /** The tasks it waits on, by title, while it waits. */
  blockedBy?: string[];
  /** Its pull request, with what the checks said when the office last heard. */
  pr?: { number: number; url: string; state: string; title: string; checks?: GhPull['checks'] };
  /** Only once it has finished: whether its work is verified. */
  verification?: Verdict;
  /** Why it hasn't started, when it hasn't and isn't waiting on another task. */
  blockers?: Blocker[];
}

/** One thing worth telling the manager, worst first. */
export interface Attention {
  kind: Blocker['kind'];
  why: string;
  since?: number;
  worker?: { id: string; name: string };
  task?: { id: string; title: string };
  /** The verdict that made this a decision rather than a nag. */
  verdict?: Verdict;
}

/** Something only a person can decide: asked, or waiting to be read. */
export interface Decision extends Attention {
  /** What the office would ask a person to do about it. */
  ask: string;
}

export interface ManagerReport {
  floor: { id: string; name: string; repo?: string; branch: string };
  at: number;
  queue: { maxWorkers: number; freeDesk: string | null; hiringPaused?: string };
  workers: ManagerWorker[];
  tasks: ManagerTask[];
  /** Tasks that finished, newest first. */
  completed: ManagerTask[];
  /** Tasks that are on it or still waiting, in queue order. */
  ongoing: ManagerTask[];
  /** What a manager would want told, worst first (see the Blocker kinds). */
  attention: Attention[];
  /** What needs a person: a question asked, or work whose verdict isn't `verified`. */
  decisions: Decision[];
}

/** Everything the report is built from: what the floor already holds. */
export interface ManagerInput {
  workers: WorkerInfo[];
  /** The rows `office-workers list` shows for those workers (server/office-workers.ts builds them). */
  rows: WorkerRow[];
  tasks: QueueTask[];
  pulls: GhPull[];
  floor: { id: string; name: string; repo?: string; branch: string };
  maxWorkers: number;
  freeDesk: string | null;
  hiringPaused?: string;
  now: number;
  /** How long a worker may be quiet before it counts as stalled; STALL_MS unless told otherwise. */
  stallMs?: number;
}

/** How bad each kind of stop is, worst first: what a manager should hear about first. */
const RANK: Record<Blocker['kind'], number> = {
  needs_input: 0,
  failed: 1,
  worktree_deleted: 2,
  stalled: 3,
  over_limit: 4,
  no_desk: 5,
  hiring_paused: 6,
};

/** What's stopping a worker, worst first; empty when nothing is. */
export function blockersOf(w: WorkerInfo, task: QueueTask | undefined, now: number, stallMs = STALL_MS): Blocker[] {
  const out: Blocker[] = [];
  if (w.status === 'needs_input') out.push({ kind: 'needs_input', why: alertDetail(w) ?? 'it is waiting on an answer', since: w.waitingSince });
  if (task && task.outcome && task.outcome !== 'done') out.push({ kind: 'failed', why: task.error ?? `it ${task.outcome}`, since: task.finishedAt });
  else if (w.status === 'exited') out.push({ kind: 'failed', why: w.exitCode === undefined ? 'its process exited' : `its process exited with code ${w.exitCode}` });
  // A worker whose terminal has gone quiet while it says it's working: its last output, or when it started.
  const quiet = w.lastOutputAt ?? (w.status === 'working' ? w.workingSince : undefined);
  if (w.status === 'working' && quiet !== undefined && now - quiet > stallMs) {
    out.push({ kind: 'stalled', why: `nothing on its terminal for ${mins(now - quiet)}`, since: quiet });
  }
  if (w.worktree && w.lost) out.push({ kind: 'worktree_deleted', why: `its worktree was deleted: rebuild it at ${w.name}'s desk, or send it home` });
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

/** Why a waiting task can't start yet, when it can't; nothing when it can. */
export function taskBlocker(t: QueueTask, running: number, freeDesk: string | null, maxWorkers: number, hiringPaused?: string): Blocker | undefined {
  if (running >= maxWorkers) return { kind: 'over_limit', why: `the queue is at its limit: ${running} of ${maxWorkers} running`, since: t.addedAt };
  if (!freeDesk) return { kind: 'no_desk', why: 'no desk or bean bag is free', since: t.addedAt };
  if (hiringPaused) return { kind: 'hiring_paused', why: hiringPaused, since: t.addedAt };
  return undefined;
}

/** Where a finished task's work stands: `verified` with a PR whose checks passed, `unverified` with no PR. */
export function verdictOf(t: QueueTask, pulls: GhPull[]): Verdict {
  if (!t.pr) return 'unverified';
  const pull = pulls.find((p) => p.number === t.pr!.number);
  if (!pull) return 'needs-review';
  return pull.checks === 'pass' || pull.checks === 'none' ? 'verified' : 'needs-review';
}

/** One task, as the manager sees it: who runs it, what it waits on, and how its work stands. */
export function managerTask(t: QueueTask, pulls: GhPull[], waiting?: string[], blocker?: Blocker): ManagerTask {
  const checks = t.pr && pulls.find((p) => p.number === t.pr!.number)?.checks;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    ...(t.outcome ? { outcome: t.outcome } : {}),
    ...(t.issue !== undefined ? { issue: t.issue } : {}),
    agent: { ...(t.provider ? { provider: t.provider } : {}), ...(t.model ? { model: t.model } : {}), ...(t.effort ? { effort: t.effort } : {}) },
    addedBy: t.addedBy,
    ...(t.workerId ? { workerId: t.workerId } : {}),
    ...(t.workerName ? { workerName: t.workerName } : {}),
    ...(t.startedAt ? { startedAt: t.startedAt } : {}),
    ...(t.finishedAt ? { finishedAt: t.finishedAt } : {}),
    ...(waiting?.length ? { blockedBy: waiting } : {}),
    ...(t.pr ? { pr: { ...t.pr, ...(checks ? { checks } : {}) } } : {}),
    ...(t.status === 'done' ? { verification: verdictOf(t, pulls) } : {}),
    ...(blocker ? { blockers: [blocker] } : {}),
  };
}

/**
 * The floor as one manager sees it. Pure over what the floor holds: every worker with its task and
 * what's blocking it, every queued task with the agent it will start on and what it's waiting on, and
 * `attention` and `decisions` for what needs telling and what needs a person.
 */
export function managerReport(input: ManagerInput): ManagerReport {
  const { workers, rows, tasks, pulls, now, stallMs = STALL_MS } = input;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seatOf = new Map(tasks.filter((t) => t.workerId).map((t) => [t.workerId!, t]));
  const crew: ManagerWorker[] = workers.map((w) => {
    const row = rows.find((r) => r.id === w.id);
    const task = seatOf.get(w.id);
    const blockers = blockersOf(w, task, now, stallMs);
    return { ...(row ?? fallbackRow(w)), ...(task ? { taskId: task.id } : {}), blockers };
  });

  const running = tasks.filter((t) => t.status === 'running').length;
  // In queue order: a waiting task lists what it waits on, a ready one why it hasn't started.
  const board = tasks.map((t) => {
    const unmet = (t.dependsOn ?? []).map((id) => byId.get(id)).filter((d): d is QueueTask => !!d && d.outcome !== 'done');
    return managerTask(t, pulls, unmet.length ? unmet.map((d) => d.title) : undefined, t.status === 'queued' && !unmet.length ? taskBlocker(t, running, input.freeDesk, input.maxWorkers, input.hiringPaused) : undefined);
  });

  const attention: Attention[] = [];
  for (const w of crew) {
    for (const b of w.blockers) attention.push({ kind: b.kind, why: b.why, ...(b.since ? { since: b.since } : {}), worker: { id: w.id, name: w.name } });
  }
  for (const t of board) {
    for (const b of t.blockers ?? []) attention.push({ kind: b.kind, why: b.why, ...(b.since ? { since: b.since } : {}), task: { id: t.id, title: t.title } });
    if (t.verification && t.verification !== 'verified') {
      attention.push({ kind: 'failed', why: verificationWhy(t), ...(t.finishedAt ? { since: t.finishedAt } : {}), task: { id: t.id, title: t.title }, verdict: t.verification });
    }
  }
  attention.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.since ?? 0) - (b.since ?? 0));

  return {
    floor: input.floor,
    at: now,
    queue: { maxWorkers: input.maxWorkers, freeDesk: input.freeDesk, ...(input.hiringPaused ? { hiringPaused: input.hiringPaused } : {}) },
    workers: crew,
    tasks: board,
    completed: board.filter((t) => t.status === 'done').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    ongoing: board.filter((t) => t.status !== 'done'),
    attention,
    decisions: attention.filter(isDecision).map((a) => ({ ...a, ask: askOf(a) })),
  };
}

/**
 * What the office hashes to decide whether the Manager agent has something new to be told: what needs
 * telling, and which tasks have finished. A floor nobody has changed hashes the same, so it is never
 * prompted twice for the same thing.
 */
export function managerHash(r: ManagerReport): string {
  const attention = r.attention.map((a) => [a.kind, a.worker?.id ?? a.task?.id ?? '', a.verdict ?? ''].join(':')).sort().join(',');
  return `${attention}|${r.completed.map((t) => `${t.id}:${t.verification ?? ''}`).join(',')}`;
}

/**
 * Whether the office should prompt the Manager agent about this floor now: something needs telling that
 * didn't before, and there's a Manager there to tell. A refusal (nobody at the kiosk, or one waiting on
 * an answer) is the caller's to ignore, and the hash is still recorded, so the same change never nags twice.
 */
export function shouldNudge(lastHash: string | undefined, hash: string, managerThere: boolean): boolean {
  return managerThere && lastHash !== hash;
}

/** A worker with no row built for it (a floor calling the builder without them): enough to read. */
function fallbackRow(w: WorkerInfo): WorkerRow {
  return { id: w.id, name: w.name, kind: w.kind, desk: w.deskId, status: w.status, hiredBy: w.createdBy, hiredAt: new Date(w.createdAt).toISOString(), merged: false, blockers: [] };
}

/** The two kinds of stop a person has to settle: a question asked, and work not verified. */
function isDecision(a: Attention): boolean {
  return a.kind === 'needs_input' || (!!a.verdict && a.verdict !== 'verified');
}

/** What the office would ask a person to decide about one of these. */
function askOf(a: Attention): string {
  if (a.kind === 'needs_input') return 'answer the question it asked';
  if (a.verdict === 'unverified') return 'read the work, or requeue the task with office-queue retry';
  return 'read the pull request and its checks before calling the task done';
}

function verificationWhy(t: ManagerTask): string {
  if (t.verification === 'unverified') return 'it finished with no pull request';
  if (t.pr) return `its checks are ${t.pr.checks ?? 'not reported'} on PR #${t.pr.number}`;
  return 'its work is not verified';
}

/** How long ago, as a person reads it. */
function mins(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return m >= 1 ? `${m} min` : `${Math.max(1, Math.floor(ms / 1000))}s`;
}