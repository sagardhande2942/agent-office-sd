import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';

test('manager routes preserve authentication, role restrictions, notes, queue choices and worker output', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-manager-server-'));
  const cfg = loadConfig([dir, '--password', 'test', '--no-open', '--agent', process.execPath]);
  cfg.port = 0; cfg.agentArgs = ['-e', "setInterval(() => console.log('alive'), 100)"];
  const office = await startServer(cfg);
  try {
    const floor = office.floors()[0]; await floor.ready; floor.queue.setLimit(0);
    const actor = floor.workers.spawn('station-manager', 'test', 'Report the floor', false, 'agent', 'custom');
    const worker = floor.workers.spawn('desk-1', 'test', undefined, false, 'agent', 'custom');
    assert.ok(typeof actor !== 'string' && typeof worker !== 'string');
    const token = JSON.parse(readFileSync(path.join(dir, '.agent-office/workers.json'), 'utf8')).find((w: {id: string}) => w.id === actor.id).hookToken;
    const call = async (route: string, body?: object, auth = token) => {
      const res = await fetch(`http://127.0.0.1:${office.hookPort}${route}${route.includes('?') ? '&' : '?'}worker=${actor.id}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await call('/office/report', undefined, 'wrong')).status, 401);
    const deadline = Date.now() + 5000;
    while (!worker.lastOutputAt && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.ok(worker.lastOutputAt);
    const status = await call('/office/report'); assert.equal(status.status, 200);
    assert.ok(status.body.workers.some((w: any) => w.id === worker.id && w.lastOutputAt));
    assert.equal((await call('/office/workers/report', { kind: 'question', text: 'Which task should run next?' })).status, 200);
    assert.equal(JSON.parse(readFileSync(path.join(dir, '.agent-office/manager.jsonl'), 'utf8').trim()).kind, 'question');
    assert.equal((await call('/office/workers/home', { workers: [worker.id], cleanup: 'all' })).status, 403);
    assert.equal((await call('/office/queue', { prompt: 'Build API', provider: 'codex', model: 'gpt-5' })).status, 200);
    const first = floor.queue.state().tasks[0]; assert.equal(first.provider, 'codex');
    assert.equal((await call('/office/queue', { prompt: 'Build UI', provider: 'pi', model: 'openai/gpt-5', depends: [first.id] })).status, 200);
    assert.deepEqual(floor.queue.state().tasks[1].dependsOn, [first.id]);
    assert.equal((await call('/office/queue', { prompt: 'Bad dependency', depends: ['missing'] })).status, 400);
    actor.planReview = { id: 'p1', role: 'candidate', locked: true };
    assert.equal((await call('/office/report')).status, 403);
    assert.equal((await call('/office/workers/report', { text: 'Unauthorized note' })).status, 403);
    assert.equal(readFileSync(path.join(dir, '.agent-office/manager.jsonl'), 'utf8').trim().split('\n').length, 1);
  } finally { office.shutdown(); await new Promise(r => setTimeout(r, 250)); rmSync(dir, { recursive: true, force: true }); }
});
