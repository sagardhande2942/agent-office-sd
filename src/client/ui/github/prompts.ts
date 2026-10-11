import type { AgentEffort, AgentProvider, GhIssue, GhMergeMethod, GhPull } from '../../../shared/protocol';
import { store, workerForPull } from '../../state';
import { repoOf } from '../../../shared/forgeweb';
import { workerPr } from '../../../shared/status';
import { overlapLines, workerFileCollisions } from '../../../shared/conflicts';
import type { MeetingPreset } from '../meeting';
import { officePrompt } from '../prompts';

// ---- Prompts for workers ------------------------------------------------------------------------

export interface BoardActions {
  /** Start a worker on a ready-made prompt (shown for editing first). With `issue`, the worker takes that GitHub issue, which moves to In progress. */
  assign(prompt: string, title: string, issue?: number): void;
  /** Your own prompt about an issue or PR; `context` goes first so the worker knows which. */
  ask(context: string, title: string): void;
  /** Walks you to the desk a pull request came from. */
  goToDesk(deskId: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, effort?: AgentEffort): void;
  /** Take the issue's card off the board, to carry to a desk or the queue (not on the 2D view, where there's nobody to carry it). */
  pickUp?(issue: GhIssue): void;
  /** Call a meeting about it: the meeting room's form, filled in. */
  meeting(preset: MeetingPreset): void;
}

/** The task a worker gets for an issue, from the board, a carried card or the queue (the 'issue.work' prompt). */
export function issuePrompt(it: Pick<GhIssue, 'number' | 'title'> & { url?: string }): string {
  return officePrompt('issue.work', issueVars(it));
}

/** What an issue's prompts fill in. A carried card has no URL, but the board usually knows it. */
export function issueVars(it: Pick<GhIssue, 'number' | 'title'> & { url?: string }) {
  return { number: it.number, title: it.title, url: it.url ?? store.issues.items.find((i) => i.number === it.number)?.url ?? '' };
}

/** owner/repo from a PR or issue URL. */
function nameWithOwner(url: string): string {
  return repoOf(url).replace(/^https?:\/\/[^/]+\//, '');
}

/** What a pull request's prompts fill in. */
export function pullVars(it: GhPull) {
  return { number: it.number, title: it.title, url: it.url, branch: it.headRefName, base: it.baseRefName };
}

export function reviewPrompt(it: GhPull) {
  return officePrompt('pull.review', pullVars(it));
}

function mergeCommand(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return `gh pr merge ${it.number} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${nameWithOwner(it.url)}`;
}

/**
 * The other open pull requests changing the same files as this one, as the fix-conflicts prompt's
 * `{{others}}`: the one thing a worker resolving conflicts doesn't know, and can't see from the PR
 * alone — several workers merge at once, and the ones landing on these files decide what the conflict
 * actually means. Empty when the office knows of no overlap, and the prompt drops the line.
 *
 * Each worker's pull request is resolved through the same workerPr the floor report uses, against
 * the board's list, and only an open one counts: a worker keeps its link and its checklist after its
 * pull request merges, so trusting the stored link would name a merged pull request as an open one,
 * and trusting only the link would miss one known by its worktree branch or its queue task.
 */
export function othersOf(it: GhPull): string {
  const mine = workerForPull(store.workers.values(), it);
  if (!mine) return '';
  const workers = [...store.workers.values()];
  const board = workers.map((w) => {
    const pr = workerPr(w, store.pulls.items, store.queue.tasks);
    const open = pr?.state === 'open' ? pr.number : undefined;
    return { id: w.id, name: w.name, ...(open !== undefined ? { pr: open } : {}), ...(w.completion?.files ? { files: w.completion.files } : {}) };
  });
  return overlapLines(workerFileCollisions(board).get(mine.id));
}

function mergeVars(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return { ...pullVars(it), repo: nameWithOwner(it.url), merge: mergeCommand(it, method, deleteBranch) };
}

export function fixAndMergePrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixMerge', mergeVars(it, method, deleteBranch));
}

export function fixConflictsPrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixConflicts', { ...mergeVars(it, method, deleteBranch), others: othersOf(it) });
}

export function pullContext(it: GhPull) {
  return officePrompt('pull.ask', pullVars(it));
}

export function issueContext(it: GhIssue) {
  return officePrompt('issue.ask', issueVars(it));
}
