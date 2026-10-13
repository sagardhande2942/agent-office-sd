import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { knowledgeFixture } from './support/knowledge-fixture.mjs';
const f = await knowledgeFixture({ commitMode: 'office' });
try {
  // Worker code stays isolated while knowledge tools share the floor store.
  f.git(['add', '.gitignore', '.agent-office/knowledge']); f.git(['commit', '-m', 'seed knowledge']);
  const task = path.join(f.home, 'task'); f.git(['worktree', 'add', '-b', 'task-knowledge', task]);
  const worker = f.floor.workers.spawn('desk-1', 'fixture', 'Knowledge task', false, 'agent', 'claude'); assert.equal(typeof worker, 'object');
  const second = f.floor.workers.spawn('desk-2', 'fixture', 'Second knowledge task', false, 'agent', 'claude'); assert.equal(typeof second, 'object');
  worker.worktree = { path: path.relative(f.project, task), branch: 'task-knowledge', base: 'main' };
  const identities = JSON.parse(fs.readFileSync(path.join(f.project, '.agent-office/workers.json'), 'utf8'));
  async function call(action, args = {}, endpoint = 'knowledge', actor = worker) {
    const token = identities.find(w => w.id === actor.id).hookToken;
    const res = await fetch(`http://127.0.0.1:${f.office.hookPort}/office/workers/${endpoint}?worker=${actor.id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(endpoint === 'knowledge' ? { ...args, action } : args) });
    return { status: res.status, body: await res.json() };
  }
  assert.match((await call('index')).body.text, /Knowledge/); assert.match((await call('index', { path: 'project' })).body.text, /project/);
  assert.equal((await call('write', { path: 'project/test.md', frontmatter: { title: 'Run tests', summary: 'Use npm test', tags: ['ci'] }, body: 'Run `npm test`.\n' })).status, 200);
  assert.match((await call('index', { path: 'project' })).body.text, /test.md.*Use npm test/);
  assert.ok(fs.existsSync(path.join(f.project, '.agent-office/knowledge/project/test.md')));
  assert.ok(!fs.existsSync(path.join(task, '.agent-office/knowledge/project/test.md')));
  const shared = (await call('read', { path: 'project/test.md' }, 'knowledge', second)).body;
  assert.match(shared.text, /npm test/);
  assert.equal((await call('write', { path: shared.path, frontmatter: { title: 'Run tests', summary: 'Use npm test' }, body: 'Run `npm test` after building.\n', expectedVersion: shared.version }, 'knowledge', second)).status, 200);
  assert.equal((await call('write', { path: shared.path, frontmatter: { title: 'Stale', summary: 'Stale' }, body: 'Overwrite', expectedVersion: shared.version })).status, 400);
  const report = { revision: worker.completionRevision ?? 0, summary: 'Knowledge fixture task', checks: [{ name: 'Fixture', status: 'passed', evidence: 'Knowledge API verified' }], files: ['.agent-office/knowledge/project/test.md'], pr: 'https://github.com/example/fixture/pull/123' };
  assert.equal((await call('', report, 'complete')).status, 400);
  assert.equal((await call('', report, 'complete')).status, 400);
  assert.equal((await call('review_done', { changed: ['project/test.md'] })).status, 200);
  assert.equal((await call('', report, 'complete')).status, 200);
  assert.match(f.git(['log', '-1', '--format=%s'], task), /seed knowledge/);
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
  const journal = fs.readFileSync(path.join(f.project, '.agent-office/handovers', `${worker.id}-${report.revision}.md`), 'utf8');
  assert.match(journal, /## Knowledge base updates/); assert.match(journal, /project\/test.md.*Use npm test/); assert.match(journal, /pull\/123/);
  console.log('PASS: authenticated tools, central memory, isolated task checkout, required review and shared handover');
} finally { await f.close(); }
