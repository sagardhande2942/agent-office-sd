import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { floorWorkerKnowledge } from '../src/server/knowledge/hooks.js';
import type { Floor } from '../src/server/floor.js';
import { KnowledgeStore } from '../src/server/knowledge/store.js';
// @ts-expect-error Plain JS CLI extensions ship without a build step.
import { KNOWLEDGE_TOOL_EXTENSION } from '../bin/office-knowledge-tools.js';
test('CLI knowledge routing preserves paths and paging as data, MCP matches command family', async () => {
  assert.deepEqual(KNOWLEDGE_TOOL_EXTENSION.parse(['knowledge', 'read', 'project/test.md', '--offset', '10', '--limit', '20', '--json']), { cmd: 'knowledge.read', args: { path: 'project/test.md', offset: 10, limit: 20 } });
  assert.deepEqual(KNOWLEDGE_TOOL_EXTENSION.parse(['knowledge', 'mv', 'a.md', 'b.md']), { cmd: 'knowledge.move', args: { from: 'a.md', to: 'b.md' } });
  assert.throws(() => KNOWLEDGE_TOOL_EXTENSION.parse(['knowledge', 'delete', 'a.md']));
  assert.deepEqual(KNOWLEDGE_TOOL_EXTENSION.tools.filter((t: any) => t.annotations.readOnlyHint).map((t: any) => t.name), ['knowledge_index', 'knowledge_read', 'knowledge_search']);
  let request: unknown;
  await KNOWLEDGE_TOOL_EXTENSION.runTool('knowledge_read', { path: 'project/test.md', offset: 20 }, { call: async (action: string, body: unknown) => { request = { action, body }; return { text: 'full page' }; }, io: {} });
  assert.deepEqual(request, { action: 'knowledge.read', body: { path: 'project/test.md', offset: 20, action: 'read' } });
});
test('knowledge loopback API rechecks auth after body read, rejects spoofed identity, and owns attribution', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-http-test-')); let authCalls = 0; let stale = false;
  const actor = { id: 'ada', kind: 'agent', deskId: 'desk-1', completionRevision: 4 };
  const floor = { def: { dir }, workers: { authenticate(id: string, token: string) { authCalls++; return id === 'ada' && token === 'fixture' && !(stale && authCalls > 1) ? actor : undefined; } } } as unknown as Floor;
  const server = http.createServer((req, res) => { void floorWorkerKnowledge(floor, req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(dir, { recursive: true, force: true }); });
  async function call(body: unknown, token = 'fixture') {
    authCalls = 0;
    const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/office/workers/knowledge?worker=ada`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  }
  assert.equal((await call({ action: 'index' }, 'wrong')).status, 401);
  stale = true; assert.equal((await call({ action: 'write', path: 'project/test.md', frontmatter: { title: 'Test', summary: 'Test command' }, body: 'Body' })).status, 401); stale = false;
  assert.equal((await call({ action: 'write', author: 'spoof', path: 'project/test.md' })).status, 400);
  assert.equal((await call({ action: 'write', path: 'project/test.md', frontmatter: { title: 'Test', summary: 'Test command', author: 'spoof' }, body: 'Body' })).status, 400);
  const saved = await call({ action: 'write', path: 'project/test.md', frontmatter: { title: 'Test', summary: 'Test command' }, body: 'Body' });
  assert.equal(saved.status, 200); assert.equal(saved.body.frontmatter.author, 'worker:ada');
  const read = await call({ action: 'read', path: 'project/test.md' });
  const updated = await call({ action: 'write', path: 'project/test.md', frontmatter: { title: 'Test', summary: 'Updated' }, body: 'New body', expectedVersion: read.body.version });
  assert.equal(updated.status, 200);
  assert.equal((await call({ action: 'write', path: 'project/test.md', frontmatter: { title: 'Test', summary: 'Stale' }, body: 'Stale body', expectedVersion: read.body.version })).status, 400);
  assert.equal((await call({ action: 'review_done', changed: [], none_reason: 'No additional facts changed' })).status, 200);
  const state = JSON.parse(fs.readFileSync(path.join(new KnowledgeStore(dir).root, '_meta/state/reviews.json'), 'utf8'));
  assert.ok(state['ada:4']);
});
