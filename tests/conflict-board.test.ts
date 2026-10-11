import test from 'node:test';
import assert from 'node:assert/strict';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';

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

const worker = (id: string, more: Partial<WorkerInfo> = {}): WorkerInfo => ({ id, deskId: 'desk-1', name: id, color: '#fff', kind: 'agent', status: 'working', createdAt: 1, worktree: { path: `w/${id}`, branch: `office/${id}`, base: 'a' }, ...more });
const pr = (number: number, headRefName: string): GhPull => ({ number, title: `PR ${number}`, state: 'OPEN', isDraft: false, url: `https://github.com/o/r/pull/${number}`, author: '', labels: [], reviewDecision: '', headRefName, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 1, deletions: 0, checks: 'none', body: '', closes: [] });
const checklist = (files: string[]) => ({ revision: 1, summary: 's', checks: [], files, submittedAt: 1, status: 'ready' as const });

function floor(workers: WorkerInfo[]) {
  store.workers.clear();
  for (const w of workers) store.workers.set(w.id, w);
}

test("a pull request names the other open pull requests changing the same files", () => {
  floor([worker('mochi', { pr: { number: 4, url: 'u' }, completion: checklist(['src/a.ts', 'src/b.ts']) }), worker('byte', { pr: { number: 5, url: 'u' }, completion: checklist(['src/a.ts']) })]);
  assert.equal(othersOf(pr(4, 'office/mochi')), 'Other open pull requests changing the same files: PR #5 from byte (src/a.ts).');
  assert.equal(othersOf(pr(5, 'office/byte')), 'Other open pull requests changing the same files: PR #4 from mochi (src/a.ts).', 'the shared path is the one both touch, whoever asks');
});

test('no overlap, or no worker behind the pull request, says nothing at all', () => {
  floor([worker('mochi', { pr: { number: 4, url: 'u' }, completion: checklist(['src/a.ts']) }), worker('byte', { pr: { number: 5, url: 'u' }, completion: checklist(['src/other.ts']) })]);
  assert.equal(othersOf(pr(4, 'office/mochi')), '');
  floor([worker('mochi', { pr: { number: 4, url: 'u' } })]);
  assert.equal(othersOf(pr(4, 'office/mochi')), '', 'a worker with no checklist reports no files, so there is no signal');
  assert.equal(othersOf(pr(99, 'office/who')), '', 'a pull request with no worker at a desk has nobody to compare');
});

test("the fix-conflicts prompt carries them, and reads as it always did when there are none", () => {
  floor([worker('mochi', { pr: { number: 4, url: 'https://github.com/o/r/pull/4' }, completion: checklist(['src/a.ts']) }), worker('byte', { pr: { number: 5, url: 'u' }, completion: checklist(['src/a.ts']) })]);
  const withOthers = fixConflictsPrompt(pr(4, 'office/mochi'), 'squash', true);
  assert.match(withOthers, /Other open pull requests changing the same files: PR #5 from byte \(src\/a\.ts\)\./);

  floor([worker('mochi', { pr: { number: 4, url: 'https://github.com/o/r/pull/4' }, completion: checklist(['src/a.ts']) })]);
  const alone = fixConflictsPrompt(pr(4, 'office/mochi'), 'squash', true);
  assert.doesNotMatch(alone, /Other open pull requests/);
  assert.doesNotMatch(alone, /\{\{/, 'no placeholder is ever handed to a worker as written');
  assert.match(alone, /has merge conflicts with `main`\. Resolve them and merge it\.\n\n1\. Get onto its branch/);
});