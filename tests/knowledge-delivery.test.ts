import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from '../src/server/knowledge/store.js';
import { applyKnowledgeActions, curationBatch } from '../src/server/knowledge/curation.js';
import { deliveries, prepareKnowledgeDelivery, finishKnowledgeDelivery, publishKnowledge, syncKnowledge, proposeKnowledgeRevert, knowledgeGit as git } from '../src/server/knowledge/delivery.js';

const fm = { title: 'Build', summary: 'Build commands' };
function fixture(t: { after(fn: () => void): void }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-delivery-test-'));
  const checkout = path.join(temp, 'project'); fs.mkdirSync(checkout);
  git(checkout, ['init', '-b', 'main']);
  const store = new KnowledgeStore(checkout); store.seed(); store.write('project/a.md', fm, 'Original', 'fixture');
  git(checkout, ['add', '.']); git(checkout, ['commit', '-m', 'seed']);
  const remote = path.join(temp, 'origin.git'); git(checkout, ['init', '--bare', remote]);
  git(checkout, ['remote', 'add', 'origin', remote]); git(checkout, ['push', '-u', 'origin', 'main']);
  t.after(() => {
    const trees = git(checkout, ['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9));
    for (const tree of trees.filter(p => p !== checkout)) { git(checkout, ['worktree', 'remove', '--force', tree]); fs.rmSync(path.dirname(tree), { recursive: true, force: true }); }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const options = {
    publishBranch(dir: string, branch: string) { git(dir, ['push', 'origin', branch]); return 'https://github.com/fixture/project/pull/123'; },
    reviewState: () => 'merged' as const,
  };
  const merge = () => git(checkout, ['push', 'origin', `${deliveries(store).at(-1)!.branch}:main`]);
  return { store, checkout, options, merge };
}
test('two writers must reread stale notes; creation, move and archive cannot overwrite newer work', async t => {
  const { store } = fixture(t); const other = new KnowledgeStore(store.checkout);
  const read = store.read('project/a.md');
  other.write('project/a.md', fm, 'Second worker', 'worker:b', read.version);
  assert.throws(() => store.write('project/a.md', fm, 'Stale', 'worker:a', read.version), /changed/);
  assert.throws(() => store.write('project/a.md', fm, 'Create', 'worker:a', null), /changed/);
  assert.throws(() => store.move('project/a.md', 'project/new.md', read.version), /changed/);
  assert.throws(() => store.archive('project/a.md', 'Old', 'worker:a', read.version), /changed/);
  store.withLock(() => assert.throws(() => other.write('project/b.md', fm, 'Body', 'worker:b'), /being updated/));
  assert.match(store.read('project/a.md').text, /Second worker/);
});
test('shared changes publish separately and merge without changing the floor branch or staging', async t => {
  const { store, checkout, options, merge } = fixture(t);
  const head = git(checkout, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(checkout, 'code.txt'), 'Other worker code'); git(checkout, ['add', 'code.txt']);
  store.write('project/a.md', fm, 'Shared update', 'worker:a');
  assert.match((await publishKnowledge(store, options)).message, /published/);
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), head);
  assert.equal(git(checkout, ['diff', '--cached', '--name-only']), 'code.txt');
  assert.equal(deliveries(store).at(-1)!.state, 'published');
  await assert.rejects(() => publishKnowledge(store, options), /pending/);
  merge(); assert.match((await syncKnowledge(store, options)).message, /Applied merged/);
  assert.equal(deliveries(store).at(-1)!.state, 'merged');
  assert.match((await publishKnowledge(store, options)).message, /No knowledge changes/);
});
test('Windows line endings do not create false pending changes or index lint errors', async t => {
  const { store, options } = fixture(t);
  for (const file of [store.resolve('project/a.md'), store.resolve('INDEX.md'), store.resolve('project/INDEX.md')]) {
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  }
  assert.match((await publishKnowledge(store, options)).message, /No knowledge changes/);
});
test('curation archive, move, split and verify remain proposals until approved', async t => {
  const { store, options, merge } = fixture(t);
  store.write('project/move.md', fm, 'Move me', 'fixture');
  store.write('project/split.md', fm, 'One and two', 'fixture');
  store.write('project/check.md', { ...fm, status: 'needs-verification' }, 'Verified body', 'fixture');
  const draft = await prepareKnowledgeDelivery(store, 'curation', options);
  const batch = curationBatch(draft.proposal, 20);
  applyKnowledgeActions(draft.proposal, batch, [
    { action: 'archive', path: 'project/a.md', reason: 'Obsolete' },
    { action: 'move', path: 'project/move.md', target: 'project/moved.md', reason: 'Organize' },
    { action: 'split', path: 'project/split.md', reason: 'Separate topics', parts: [
      { path: 'project/one.md', ...fm, body: 'One' }, { path: 'project/two.md', ...fm, body: 'Two' },
    ] },
    { action: 'verify', path: 'project/check.md', reason: 'Checked', evidence: ['src/build.ts'] },
  ], 'abcdef123');
  await finishKnowledgeDelivery(store, draft, options);
  assert.equal(store.tree().find(n => n.path === 'project/a.md')!.frontmatter!.status, 'active');
  assert.ok(fs.existsSync(store.resolve('project/move.md')));
  merge(); await syncKnowledge(store, options);
  assert.equal(store.tree().find(n => n.path === 'project/a.md')!.frontmatter!.status, 'archived');
  assert.equal(store.tree().find(n => n.path === 'project/split.md')!.frontmatter!.status, 'archived');
  assert.equal(store.tree().find(n => n.path === 'project/check.md')!.frontmatter!.status, 'active');
  assert.ok(!fs.existsSync(store.resolve('project/move.md')));
  assert.match(store.read('project/moved.md').text, /Move me/);
  assert.match(store.read('project/one.md').text, /One/);
});
test('approved move is all-or-nothing when its destination is created concurrently', async t => {
  const { store, options, merge } = fixture(t);
  const draft = await prepareKnowledgeDelivery(store, 'curation', options);
  draft.proposal.move('project/a.md', 'project/destination.md');
  await finishKnowledgeDelivery(store, draft, options);
  store.write('project/destination.md', fm, 'Concurrent discovery', 'worker:b');
  merge(); assert.match((await syncKnowledge(store, options)).message, /needs reconciliation/);
  assert.match(store.read('project/a.md').text, /Original/);
  assert.match(store.read('project/destination.md').text, /Concurrent discovery/);
});
test('curator skips a split when any new destination already exists', async t => {
  const { store } = fixture(t); const batch = curationBatch(store, 10);
  store.write('project/one.md', fm, 'Someone else', 'worker:b');
  const result = applyKnowledgeActions(store, batch, [{ action: 'split', path: 'project/a.md', reason: 'Split', parts: [
    { path: 'project/one.md', ...fm, body: 'One' }, { path: 'project/two.md', ...fm, body: 'Two' },
  ] }], 'abcdef123');
  assert.equal(result.skipped, 1); assert.ok(!fs.existsSync(store.resolve('project/two.md')));
});
test('publisher failure preserves a reviewable branch and leaves live notes untouched', async t => {
  const { store } = fixture(t); store.write('project/a.md', fm, 'Pending', 'worker:a');
  await assert.rejects(() => publishKnowledge(store, { publishBranch() { throw Error('Forge unavailable'); } }), /Forge unavailable/);
  assert.equal(deliveries(store).at(-1)!.state, 'failed');
  assert.match(deliveries(store).at(-1)!.error!, /retained/);
  assert.match(store.read('project/a.md').text, /Pending/);
});
test('restore publishes a review instead of committing on the shared floor branch', async t => {
  const { store, checkout, options, merge } = fixture(t);
  store.write('project/a.md', fm, 'Updated', 'worker:a');
  await publishKnowledge(store, options); const first = deliveries(store).at(-1)!;
  const commit = git(checkout, ['rev-parse', first.branch]); merge(); await syncKnowledge(store, options);
  const head = git(checkout, ['rev-parse', 'HEAD']);
  await proposeKnowledgeRevert(store, commit, options);
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), head);
  assert.match(store.read('project/a.md').text, /Updated/);
  merge(); await syncKnowledge(store, options);
  assert.match(store.read('project/a.md').text, /Original/);
});
test('fresh upstream notes survive a local publication and an overlapping upstream edit is rejected', async t => {
  const { store, checkout, options, merge } = fixture(t);
  const first = await prepareKnowledgeDelivery(store, 'curation', options);
  first.proposal.write('project/upstream.md', fm, 'Upstream discovery', 'curator');
  await finishKnowledgeDelivery(store, first, options); merge();
  // Closed without applying simulates a floor whose files have not caught up to origin/main.
  await syncKnowledge(store, { ...options, reviewState: () => 'closed' });
  store.write('project/a.md', fm, 'Local discovery', 'worker:a');
  await publishKnowledge(store, options);
  assert.match(git(checkout, ['show', `${deliveries(store).at(-1)!.branch}:.agent-office/knowledge/project/upstream.md`]), /Upstream discovery/);
  merge(); await syncKnowledge(store, { ...options, reviewState: () => 'closed' });
  store.write('project/a.md', fm, 'Conflicting local edit', 'worker:b');
  await assert.rejects(() => publishKnowledge(store, options), /conflict with origin\/main/);
});
