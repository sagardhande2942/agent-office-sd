import type { CompletionReport } from './completion.js';
// What a worker's status means, for the checks the server and the browser both make.

import type { AgentProvider, GhPull, QueueTask, WorkerInfo, WorkerStatus } from './protocol.js';

/**
 * Whether a worker can go on a break round the office (see WorkerInfo.resting), or is on one: an
 * agent that's finished, at a desk of its own (not a board agent's kiosk, not in a meeting).
 */
export function canRest(w: WorkerInfo, station?: boolean): boolean {
  return w.kind === 'agent' && !w.helper && !w.lost && !station && !w.deskId.startsWith('station-') && !w.meeting && (w.status === 'idle' || w.status === 'done');
}

/** Its process isn't running: it exited, or came back asleep after a restart. R wakes it. */
export function isAsleep(status: WorkerStatus): boolean {
  return status === 'exited' || status === 'offline';
}

/** In the middle of a turn: booting, working, or waiting on an answer. */
export function isBusy(status: WorkerStatus): boolean {
  return status === 'starting' || status === 'working' || status === 'needs_input';
}

/**
 * One line for a notification about a worker: what it's asking for when it needs input, or what it
 * was on when it's done (its last activity may be a permission prompt it has long got past).
 */
export function alertDetail(w: WorkerInfo): string | undefined {
  return w.status === 'needs_input' ? (w.activity ?? w.task?.summary) : (w.task?.summary ?? w.prompt);
}

/** A worker's pull request: still open, or merged (time to send it home). */
export interface WorkerPr {
  state: 'open' | 'merged';
  number: number;
}

/**
 * Where its work stands on GitHub: a pull request from its desk, its worktree branch or its queue
 * task, or one it opened itself, is open (one still open wins, e.g. a follow-up on the same branch), or merged, so it can be
 * sent home. Undefined when it has none, or only closed ones.
 */
export function workerPr(w: WorkerInfo, pulls: GhPull[], tasks: QueueTask[]): WorkerPr | undefined {
  const mine = new Set<number>();
  if (w.pr) mine.add(w.pr.number);
  for (const n of w.pastPrs ?? []) mine.add(n);
  for (const t of tasks) if (t.workerId === w.id && t.pr) mine.add(t.pr.number);
  const seen = pulls.filter((p) => mine.has(p.number) || (w.worktree && w.worktree.branch === p.headRefName)).map((p) => ({ number: p.number, state: p.state }));
  // Its task's PR can drop off the list GitHub sends (the last 30 merged): keep what the queue saw.
  for (const t of tasks) if (t.workerId === w.id && t.pr && !seen.some((p) => p.number === t.pr!.number)) seen.push({ number: t.pr.number, state: t.pr.state });
  // Opened from its desk but not on the list yet (still loading, or no gh to ask): it's open.
  if (w.pr && !seen.some((p) => p.number === w.pr!.number)) seen.push({ number: w.pr.number, state: 'OPEN' });
  const open = seen.find((p) => p.state === 'OPEN' || p.state === 'DRAFT');
  if (open) return { state: 'open', number: open.number };
  const merged = seen.find((p) => p.state === 'MERGED');
  return merged && { state: 'merged', number: merged.number };
}

/** One worker as an agent sees it: enough to pick the ones to send home, and say why. */
export interface WorkerRow {
  completion?: CompletionReport;
  id: string;
  name: string;
  kind: 'agent' | 'shell';
  provider?: AgentProvider;
  model?: string;
  desk: string;
  status: WorkerStatus;
  /** The board it stands by, for a board agent ("PR agent"). */
  board?: string;
  /** At the meeting room's table, called to a meeting. */
  meeting?: true;
  /** The worker asking. */
  you?: true;
  /** What it's on, as the office summed it up, else its first prompt. */
  task?: string;
  /** Its latest prompt or tool call. */
  activity?: string;
  hiredBy: string;
  hiredAt: string;
  /** People with its terminal open. */
  viewers?: string[];
  /** `deleted`: its folder was deleted outside the office, so it can't start until someone rebuilds it at its desk. */
  worktree?: { path: string; branch: string; deleted?: true };
  /** Other floors' projects it works in too, each on its own worktree. */
  repos?: { name: string; branch: string; pr?: number }[];
  /** Its pull request: one still open wins, else one that merged (see workerPr). */
  pr?: { number: number; state: 'open' | 'merged'; title?: string; url?: string };
  /** A pull request of its merged and none is open: its work landed, and it can go home. */
  merged: boolean;
  /** Its work landed, but it doesn't go home by itself yet, and why (see notLeaving). */
  staying?: string;
  /** When its terminal last wrote something: what "stalled" is worked out from (see blockersOf). */
  lastOutputAt?: number;
  /** What's stopping it, worst first; empty when nothing is (see blockersOf). */
  blockers: Blocker[];
}

/** What a floor knows about its workers' pull requests. */
export interface PullsView {
  pulls: GhPull[];
  tasks: QueueTask[];
  /** Another floor's pull requests, for a worker across repositories. */
  pullsOf?: (floor: string) => GhPull[] | undefined;
}

/** Why a worker or a task isn't getting on: what kind of stop it is, in words, and since when. */
export interface Blocker {
  kind: 'needs_input' | 'failed' | 'stalled' | 'worktree_deleted' | 'no_desk' | 'over_limit' | 'hiring_paused';
  why: string;
  since?: number;
}
