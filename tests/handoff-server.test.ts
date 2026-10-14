import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
test('authenticated handoff API delivers into existing inbox without interrupting working terminals', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-handoff-api-'));
  const cfg = loadConfig([dir, '--password', 'handoff-test', '--no-open', '--agent', process.execPath]);
  cfg.port = 0; cfg.agentArgs = ['-e', 'setInterval(() => {}, 1000)'];
  const office = await startServer(cfg);
  try {
    const floor = office.floors()[0]; await floor.ready;
    const source = await floor.workers.spawn('desk-1', 'tester', undefined, false, 'agent', 'custom');
    const target = await floor.workers.spawn('desk-2', 'tester', undefined, false, 'agent', 'custom');
    const stranger = await floor.workers.spawn('desk-3', 'tester', undefined, false, 'agent', 'custom');
    assert.ok(typeof source !== 'string' && typeof target !== 'string' && typeof stranger !== 'string');
    const token = (id: string) => JSON.parse(readFileSync(path.join(dir, '.agent-office/workers.json'), 'utf8')).find((w: any) => w.id === id).hookToken;
    floor.workers.prompt = async () => { throw Error('Must not interrupt terminal'); };
    floor.workers.resume = () => { throw Error('Must not wake worker'); };
    const call = async (worker: string, action: string, body?: object, bearer = token(worker)) => {
      const res = await fetch(`http://127.0.0.1:${office.hookPort}/office/workers/${action}?worker=${worker}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await call(source.id, 'handoff', { action: 'prefill' }, 'bad')).status, 401);
    const revision = (await call(source.id, 'handoff', { action: 'prefill' })).body.revision;
    const body = { action: 'create', key: 'api-packet', recipient: target.id, revision, goal: 'Continue tests', completedWork: 'Investigated protocol', nextSteps: 'Implement validation', files: [], filesNote: 'None yet', checks: [{ name: 'tests', status: 'skipped', evidence: 'Investigation only; no implementation yet' }], questions: [], questionsNote: 'None' };
    const created = await call(source.id, 'handoff', body); assert.equal(created.status, 200);
    const packet = created.body.handoff;
    assert.equal((await call(source.id, 'handoff', body)).body.handoff.id, packet.id);
    assert.equal((await call(target.id, 'inbox')).body.messages.find((m: any) => m.id === packet.messageId).status, 'delivered');
    assert.equal((await call(stranger.id, 'handoff', { action: 'accept', id: packet.id })).status, 400);
    assert.equal((await call(source.id, 'handoff', { ...body, key: 'stale', revision: revision + 1 })).status, 400);
    assert.equal((await call(source.id, 'handoff', { ...body, key: 'floor', recipient: 'other-floor-id' })).status, 400);
    const origin = `http://localhost:${(office.server.address() as any).port}`;
    const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'handoff-test' }) });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const observed = await fetch(`${origin}/api/handoffs?floor=${floor.id}`, { headers: { cookie } });
    assert.equal(observed.status, 200); assert.equal((await observed.json() as any).handoffs[0].state, 'offered');
    const accepted = await call(target.id, 'handoff', { action: 'accept', id: packet.id }); assert.equal(accepted.status, 200);
    assert.deepEqual((await call(target.id, 'handoff', { action: 'accept', id: packet.id })).body, accepted.body);
    assert.equal(floor.workers.get(source.id)?.completion, undefined);
  } finally { office.shutdown(); await new Promise(resolve => setTimeout(resolve, 300)); rmSync(dir, { recursive: true, force: true }); }
});
