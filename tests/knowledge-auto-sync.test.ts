import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerMsg } from '../src/shared/protocol.js';
import { KnowledgeStore } from '../src/server/knowledge/store.js';
import { KnowledgeAutoSync } from '../src/server/knowledge/auto-sync.js';
import { knowledgeGit as git, prepareKnowledgeDelivery, finishKnowledgeDelivery, deliveries, syncKnowledge } from '../src/server/knowledge/delivery.js';

const fm = { title: 'Build', summary: 'Build commands' };
test('polling an uninitialized legacy floor does not create a partial knowledge tree', async t => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-auto-unseeded-'));
  t.after(() => fs.rmSync(checkout, { recursive: true, force: true }));
  const auto = new KnowledgeAutoSync(checkout, () => assert.fail('Unexpected sync notification'), { timer: false });
  t.after(() => auto.close());
  await auto.tick();
  assert.equal(fs.existsSync(path.join(checkout, '.agent-office/knowledge')), false);
  const store = new KnowledgeStore(checkout); store.seed();
  assert.match(store.index(), /Knowledge/);
});
async function fixture(t: { after(fn: () => void): void }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-auto-sync-'));
  const checkout = path.join(temp, 'project'); fs.mkdirSync(checkout);
  git(checkout, ['init', '-b', 'main']);
  const store = new KnowledgeStore(checkout); store.seed();
  store.write('project/a.md', fm, 'Original', 'fixture');
  git(checkout, ['add', '.']); git(checkout, ['commit', '-m', 'seed']);
  const remote = path.join(temp, 'origin.git'); git(checkout, ['init', '--bare', remote]);
  git(checkout, ['remote', 'add', 'origin', remote]); git(checkout, ['push', '-u', 'origin', 'main']);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const draft = await prepareKnowledgeDelivery(store, 'curation', { publishBranch: () => 'fixture' });
  draft.proposal.write('project/a.md', fm, 'Approved update', 'fixture');
  await finishKnowledgeDelivery(store, draft, { publishBranch(dir, branch) { git(dir, ['push', 'origin', branch]); return 'fixture'; } });
  const merge = () => git(checkout, ['push', 'origin', `${draft.record.branch}:main`]);
  const messages: ServerMsg[] = [];
  return { checkout, store, merge, messages };
}

test('background check applies a merged review, broadcasts it and coalesces manual sync', async t => {
  const { checkout, store, merge, messages } = await fixture(t); merge();
  const head = git(checkout, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(checkout, 'code.txt'), 'Other worker'); git(checkout, ['add', 'code.txt']);
  let calls = 0;
  const delivery = { reviewState: () => { calls++; return 'merged' as const; } };
  const auto = new KnowledgeAutoSync(checkout, msg => messages.push(msg), { timer: false, delivery }); t.after(() => auto.close());
  await Promise.all([auto.tick(), auto.tick(), syncKnowledge(store, delivery)]);
  assert.equal(calls, 1);
  assert.match(store.read('project/a.md').text, /Approved update/);
  assert.equal(deliveries(store).at(-1)!.state, 'merged');
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), head);
  assert.equal(git(checkout, ['diff', '--cached', '--name-only']), 'code.txt');
  assert.ok(messages.some(msg => msg.t === 'knowledge/tree' && msg.tree.deliveries.some(r => r.state === 'merged')));
  assert.ok(messages.some(msg => msg.t === 'knowledge/status' && /Applied merged/.test(msg.message)));
  await auto.tick(); assert.equal(calls, 1);
});

test('automatic sync preserves conflicting edits and reports reconciliation without repeated messages', async t => {
  const { checkout, store, merge, messages } = await fixture(t); merge();
  store.write('project/a.md', fm, 'Concurrent edit', 'worker:b');
  const auto = new KnowledgeAutoSync(checkout, msg => messages.push(msg), { timer: false, delivery: { reviewState: () => 'merged' } }); t.after(() => auto.close());
  await auto.tick();
  assert.match(store.read('project/a.md').text, /Concurrent edit/);
  assert.deepEqual(deliveries(store).at(-1)!.conflicts, ['project/a.md']);
  assert.ok(messages.some(msg => msg.t === 'knowledge/status' && /reconciliation/.test(msg.message)));
  const count = messages.length; await auto.tick(); assert.equal(messages.length, count);
});

test('startup polling retries transient forge failures, catches merged reviews and stops on close', async t => {
  const { checkout, store, merge, messages } = await fixture(t); merge();
  let fail = true; let calls = 0;
  const auto = new KnowledgeAutoSync(checkout, msg => messages.push(msg), { intervalMs: 10, delivery: { reviewState: () => { calls++; if (fail) throw Error('Forge offline'); return 'merged'; } } }); t.after(() => auto.close());
  await auto.tick(); await auto.tick();
  assert.equal(deliveries(store).at(-1)!.state, 'published');
  assert.equal(messages.filter(msg => msg.t === 'knowledge/status' && /Forge offline/.test(msg.message)).length, 1);
  fail = false;
  const deadline = Date.now() + 10_000;
  while (deliveries(store).at(-1)!.state !== 'merged' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(deliveries(store).at(-1)!.state, 'merged');
  auto.close(); const count = calls;
  await new Promise(resolve => setTimeout(resolve, 30)); await auto.tick(); assert.equal(calls, count);
});

test('open reviews remain pending and closed reviews preserve live notes', async t => {
  const { checkout, store, messages } = await fixture(t);
  let state: 'published' | 'closed' = 'published';
  const auto = new KnowledgeAutoSync(checkout, msg => messages.push(msg), { timer: false, delivery: { reviewState: () => state } }); t.after(() => auto.close());
  await auto.tick(); assert.equal(messages.length, 0);
  assert.equal(deliveries(store).at(-1)!.state, 'published');
  state = 'closed'; await auto.tick();
  assert.equal(deliveries(store).at(-1)!.state, 'closed');
  assert.match(store.read('project/a.md').text, /Original/);
});
