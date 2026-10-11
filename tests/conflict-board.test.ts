import test from 'node:test';
import assert from 'node:assert/strict';
import type { GhPull, QueueTask, WorkerInfo } from '../src/shared/protocol.js';

// The client store keeps the floor you're on in localStorage and times things by performance.now():
// stand both in, before the store's module makes the store.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});
let clock = 1000;
Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => (clock += 10) });

const { store } = await import('../src/client/state/index.js');
const { othersOf, fixConflictsPrompt } = await import('../src/client/ui/github/prompts.js');

// Which other open pull requests land on the same files as this one: what the ✨ Fix conflicts & merge
// button shows under itself, and the {{others}} line of the prompt it hands a worker.
//
// A worker keeps its pull request link and its checklist long after the pull request merges, so these
// are read against the board's pull request list, not off the worker's link: the floor report resolves
// each worker's current pull request the same way, and the two must not disagree.

const worker = (id: string, more: Partial<WorkerInfo> = {}): WorkerInfo => ({ id, deskId: `desk-${id}`, name: id, color: '#fff', kind: 'agent', status: 'working', createdAt: 1, worktree: { path: `w/${id}`, branch: `office/${id}`, base: 'a' }, ...more });
const pr = (number: number, headRefName: string, state = 'OPEN'): GhPull => ({ number, title: `PR ${number}`, state, isDraft: false, url: `https://github.com/o/r/pull/${number}`, author: '', labels: [], reviewDecision: '', headRefName, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 1, deletions: 0, checks: 'none', body: '', closes: [] });
const checklist = (files: string[]) => ({ revision: 1, summary: 's', checks: [], files, submittedAt: 1, status: 'ready' as const });

/** The floor as the board and the workers report it. */
function floor(workers: WorkerInfo[], pulls: GhPull[], tasks: QueueTask[] = []) {
  store.workers.clear();
  for (const w of workers) store.workers.set(w.id, w);
  store.apply({ t: 'gh.pulls', state: { items: pulls, fetchedAt: 1, loading: false, forge: 'github' } });
  store.apply({ t: 'queue', state: { tasks, maxWorkers: 2 } });
}

const linked = (id: string, number: number, files: string[]) => worker(id, { pr: { number, url: 'u' }, completion: checklist(files) });

test("a pull request names the other open pull requests changing the same files", () => {
  floor([linked('mochi', 4, ['src/a.ts', 'src/b.ts']), linked('byte', 5, ['src/a.ts'])], [pr(4, 'office/mochi'), pr(5, 'office/byte')]);
  assert.equal(othersOf(pr(4, 'office/mochi')), 'Other open pull requests changing the same files: PR #5 from byte (src/a.ts).');
  assert.equal(othersOf(pr(5, 'office/byte')), 'Other open pull requests changing the same files: PR #4 from mochi (src/a.ts).', 'the shared path is the one both touch, whoever asks');
});

test("a worker's pull request that merged or closed stops being named as open", () => {
  for (const state of ['MERGED', 'CLOSED']) {
    // Byte's link and its checklist are both still on the worker: only the board knows it is over.
    floor([linked('mochi', 4, ['src/a.ts']), linked('byte', 5, ['src/a.ts'])], [pr(4, 'office/mochi'), pr(5, 'office/byte', state)]);
    assert.equal(othersOf(pr(4, 'office/mochi')), '', `PR #5 is ${state}, so it is not another open pull request`);
    assert.doesNotMatch(fixConflictsPrompt(pr(4, 'office/mochi'), 'squash', true), /#5/, `and the prompt does not send a worker to a ${state.toLowerCase()} pull request`);
  }
});

test('a worker whose pull request is known by its branch or its task, not its link, is still found', () => {
  // Byte never set w.pr; the board links its worktree branch to the open pull request.
  floor([linked('mochi', 4, ['src/a.ts']), worker('byte', { completion: checklist(['src/a.ts']) })], [pr(4, 'office/mochi'), pr(5, 'office/byte')]);
  assert.equal(othersOf(pr(4, 'office/mochi')), 'Other open pull requests changing the same files: PR #5 from byte (src/a.ts).', 'its worktree branch is the office\'s own way of knowing whose pull request it is');

  // And the same through a queue task, on a branch no worker is sitting on.
  const task: QueueTask = { id: 't1', title: 't', prompt: 'p', addedBy: 'Queue agent', addedAt: 1, status: 'running', workerId: 'byte', pr: { number: 5, url: 'u', state: 'OPEN', title: 't' } };
  floor([linked('mochi', 4, ['src/a.ts']), worker('byte', { completion: checklist(['src/a.ts']) })], [pr(4, 'office/mochi'), pr(5, 'office/queued-branch')], [task]);
  assert.equal(othersOf(pr(4, 'office/mochi')), 'Other open pull requests changing the same files: PR #5 from byte (src/a.ts).');
});

test('no overlap, or no worker behind the pull request, says nothing at all', () => {
  floor([linked('mochi', 4, ['src/a.ts']), linked('byte', 5, ['src/other.ts'])], [pr(4, 'office/mochi'), pr(5, 'office/byte')]);
  assert.equal(othersOf(pr(4, 'office/mochi')), '');
  floor([linked('mochi', 4, ['src/a.ts'])], [pr(4, 'office/mochi')]);
  assert.equal(othersOf(pr(4, 'office/mochi')), '', 'a worker with no checklist reports no files, so there is no signal');
  assert.equal(othersOf(pr(99, 'office/who')), '', 'a pull request with no worker at a desk has nobody to compare');
  floor([worker('mochi', { completion: checklist(['src/a.ts']) })], []);
  assert.equal(othersOf(pr(4, 'office/mochi')), '', 'a pull request the board has never listed cannot be resolved to a worker\'s open one');
});

test("the fix-conflicts prompt carries them, and reads as it always did when there are none", () => {
  floor([worker('mochi', { pr: { number: 4, url: 'https://github.com/o/r/pull/4' }, completion: checklist(['src/a.ts']) }), linked('byte', 5, ['src/a.ts'])], [pr(4, 'office/mochi'), pr(5, 'office/byte')]);
  const withOthers = fixConflictsPrompt(pr(4, 'office/mochi'), 'squash', true);
  assert.match(withOthers, /Other open pull requests changing the same files: PR #5 from byte \(src\/a\.ts\)\./);

  floor([worker('mochi', { pr: { number: 4, url: 'https://github.com/o/r/pull/4' }, completion: checklist(['src/a.ts']) })], [pr(4, 'office/mochi')]);
  const alone = fixConflictsPrompt(pr(4, 'office/mochi'), 'squash', true);
  assert.doesNotMatch(alone, /Other open pull requests/);
  assert.doesNotMatch(alone, /\{\{/, 'no placeholder is ever handed to a worker as written');
  assert.match(alone, /has merge conflicts with `main`\. Resolve them and merge it\.\n\n1\. Get onto its branch/);
});