import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAP_FILES_MAX, OVERLAP_WORKERS_MAX, isConflicting, normalizeFilePath, overlapLines, sharedFiles, workerFileCollisions, type CollisionWorker } from '../src/shared/conflicts.js';

// What makes a pull request conflicting is one rule, in one place: the client that shows it and the
// server that reports it both read isConflicting here, so they cannot drift apart.

const pull = (more: Partial<Parameters<typeof isConflicting>[0]> = {}) => ({ state: 'OPEN', isDraft: false, ...more });

test('an open pull request conflicts when the forge says CONFLICTING or DIRTY', () => {
  assert.equal(isConflicting(pull({ mergeable: 'CONFLICTING' })), true);
  assert.equal(isConflicting(pull({ mergeStateStatus: 'DIRTY' })), true);
  assert.equal(isConflicting(pull({ mergeable: 'MERGEABLE', mergeStateStatus: 'DIRTY' })), true, 'DIRTY says it even when mergeable has caught up');
});

test('anything the forge calls mergeable, or nothing at all, is not a conflict', () => {
  for (const state of ['CLEAN', 'BLOCKED', 'BEHIND', 'UNSTABLE', 'HAS_HOOKS', 'UNKNOWN', '']) {
    assert.equal(isConflicting(pull({ mergeable: 'MERGEABLE', mergeStateStatus: state })), false, state);
    assert.equal(isConflicting(pull({ mergeable: 'UNKNOWN', mergeStateStatus: state })), false, `UNKNOWN mergeable with ${state}`);
  }
  // A forge that reports no merge state at all (Bitbucket) is silence, not a wrong answer.
  assert.equal(isConflicting(pull()), false);
});

test('a draft, a merged or a closed pull request is never a conflict, whatever the forge says', () => {
  assert.equal(isConflicting(pull({ isDraft: true, mergeStateStatus: 'DIRTY' })), false);
  assert.equal(isConflicting(pull({ state: 'MERGED', mergeStateStatus: 'DIRTY' })), false);
  assert.equal(isConflicting(pull({ state: 'CLOSED', mergeable: 'CONFLICTING' })), false);
});

test('a path is normalized so the same file reads the same from either end', () => {
  assert.equal(normalizeFilePath('./src/a.ts'), 'src/a.ts');
  assert.equal(normalizeFilePath('/src/a.ts'), 'src/a.ts');
  assert.equal(normalizeFilePath('src/A.ts'), 'src/a.ts');
  assert.equal(normalizeFilePath('  src/a.ts  '), 'src/a.ts');
  assert.equal(normalizeFilePath(''), '');
});

test('files are shared on the exact path, never on a prefix', () => {
  assert.deepEqual(sharedFiles(['./src/A.ts', 'src/b.ts'], ['src/a.ts']), ['src/a.ts'], 'the same file, written differently');
  assert.deepEqual(sharedFiles(['src/a.ts'], ['src/ab.ts']), [], 'a shared directory is not a shared file');
  assert.deepEqual(sharedFiles([], ['src/a.ts']), []);
  assert.deepEqual(sharedFiles(['src/a.ts'], []), []);
  assert.deepEqual(sharedFiles(['src/a.ts', './src/A.TS'], ['src/a.ts']), ['src/a.ts'], 'the same path twice is one shared file');
});

const worker = (id: string, pr: number | undefined, files?: string[]): CollisionWorker => ({ id, name: id, ...(pr !== undefined ? { pr } : {}), ...(files ? { files } : {}) });

test('two workers whose open pull requests touch a file are both told about the other', () => {
  const map = workerFileCollisions([worker('mochi', 11, ['src/a.ts', 'docs/x.md']), worker('byte', 12, ['src/a.ts'])]);
  assert.deepEqual(map.get('mochi'), [{ worker: { id: 'byte', name: 'byte' }, pr: 12, files: ['src/a.ts'] }]);
  assert.deepEqual(map.get('byte'), [{ worker: { id: 'mochi', name: 'mochi' }, pr: 11, files: ['src/a.ts'] }]);
});

test('workers on disjoint files, or with no pull request or no checklist, overlap nothing', () => {
  const map = workerFileCollisions([worker('mochi', 11, ['src/a.ts']), worker('byte', 12, ['src/b.ts'])]);
  assert.equal(map.size, 0);
  assert.equal(workerFileCollisions([worker('mochi', undefined, ['src/a.ts']), worker('byte', 12, ['src/a.ts'])]).size, 0, 'no open pull request, nothing to collide on');
  assert.equal(workerFileCollisions([worker('mochi', 11, ['src/a.ts']), worker('byte', 12)]).size, 0, 'no checklist, no signal');
  assert.equal(workerFileCollisions([]).size, 0);
});

test('a worker with no overlaps is left out of the map rather than given an empty list', () => {
  const map = workerFileCollisions([worker('mochi', 11, ['src/a.ts']), worker('byte', 12, ['src/b.ts']), worker('kumo', 13, ['src/a.ts'])]);
  assert.deepEqual([...map.keys()].sort(), ['kumo', 'mochi']);
});

test('the overlap list is capped, and says when it was capped rather than truncating quietly', () => {
  const many = Array.from({ length: OVERLAP_WORKERS_MAX + 3 }, (_, i) => worker(`w${i}`, 20 + i, ['src/a.ts']));
  const list = workerFileCollisions([...many, worker('mochi', 11, ['src/a.ts'])])!.get('mochi')!;
  assert.equal(list.length, OVERLAP_WORKERS_MAX);

  const manyFiles = Array.from({ length: OVERLAP_FILES_MAX + 4 }, (_, i) => `src/f${i}.ts`);
  const [one] = workerFileCollisions([worker('mochi', 11, manyFiles), worker('byte', 12, manyFiles)])!.get('mochi')!;
  assert.equal(one.files.length, OVERLAP_FILES_MAX);
  assert.equal(one.capped, true, 'more shared files than are named, and it says so');
  assert.equal(workerFileCollisions([worker('mochi', 11, ['src/a.ts']), worker('byte', 12, ['src/a.ts'])])!.get('mochi')![0].capped, undefined);
});

test('an overlap reads as a sentence naming the other pull request and the shared files', () => {
  const list = workerFileCollisions([worker('mochi', 11, ['src/a.ts']), worker('byte', 12, ['src/a.ts'])])!.get('mochi')!;
  assert.equal(overlapLines(list), 'Other open pull requests changing the same files: PR #12 from byte (src/a.ts).');
  assert.equal(overlapLines([]), '', 'nothing to say, so the prompt drops the line');
});