import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { ResearchStore } from '../src/server/trading-research/coordinator/store.js';
import { researchServer } from '../src/server/trading-research/coordinator/server.js';
import { localResearch } from '../src/server/trading-research/link.js';
import { researchHostCalls } from '../src/server/trading-research/host.js';
import { RemoteResearch } from '../src/server/trading-research/remote.js';
import { researchHandlers } from '../src/server/ws/handlers/trading-research.js';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import type { ResearchBrief } from '../src/shared/trading-research.js';
const brief: ResearchBrief = { objective: 'Research a bounded hypothesis', constraints: 'No live trading', symbols: ['EURUSD'], timeframe: 'M1', start: '20230101', end: '20240101', dataset: 'test-data-v1', maxExperiments: 2, maxWorkers: 2, timeoutMinutes: 1, walkForward: false };
async function wait(predicate: () => boolean) { const until = Date.now() + 6000; while (!predicate() && Date.now() < until) await new Promise(r => setTimeout(r, 20)); assert.ok(predicate(), 'Expected state within six seconds'); }

test('coordinator requires authentication and separates scope state', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'research-http-')), store = new ResearchStore(dir), token = 'a'.repeat(64), server = researchServer(store, token);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 401);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/health', { headers })).status, 200);
    assert.equal((await fetch(base + '/v1/scopes/a/action', { method: 'POST', headers, body: JSON.stringify({ action: 'create', brief, requestId: 'one' }) })).status, 200);
    const other = await (await fetch(base + '/v1/scopes/b/state', { headers })).json() as any; assert.equal(other.campaigns.length, 0);
    assert.equal((await fetch(base + '/v1/scopes/a/action', { method: 'POST', headers, body: '{bad' })).status, 400);
  } finally { await new Promise<void>(r => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});

test('real Office workers receive assignments, authenticate submissions and synchronize research views', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-research-')), command = path.join(dir, 'claude');
  writeFileSync(command, `#!${process.execPath}\nif(process.argv.includes('-p')||process.argv.includes('--print')) { console.log(JSON.stringify({name:'Research',summary:'Research assignment'})); process.exit(0); }\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
  const coordinator = researchServer(new ResearchStore(path.join(dir, 'coordinator')), 'b'.repeat(64));
  await new Promise<void>(r => coordinator.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(coordinator.address() as { port: number }).port}`;
  const cfg = loadConfig([dir, '--password', 'research-test', '--no-open', '--agent', command]); cfg.port = 0;
  const office = await startServer(cfg); const sockets: WebSocket[] = [];
  try {
    const floor = office.floors()[0]; await floor.ready;
    const link = localResearch(floor); const configured = await link.configure({ enabled: true, url, token: 'b'.repeat(64) }); assert.equal(configured.connected, true);
    const view = await link.action({ action: 'create', brief, requestId: 'campaign' });
    const worker = floor.workers.spawn('desk-1', 'tester', undefined, false, 'agent', 'claude'); assert.ok(typeof worker !== 'string');
    // A fake interactive agent has no status hook, so mark its existing session ready.
    worker.status = 'idle';
    const assigned = await link.dispatch(view.state!.assignments[0].id, worker.id, 'tester');
    assert.ok(!assigned.state!.assignments[0].lease, 'browser view must never expose assignment leases');
    const token = JSON.parse(readFileSync(path.join(dir, '.agent-office/workers.json'), 'utf8')).find((w: any) => w.id === worker.id).hookToken;
    const hook = `http://127.0.0.1:${office.hookPort}/office/workers/research?worker=${worker.id}`;
    const call = async (body?: unknown, bearer = token) => fetch(hook, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await call(undefined, 'wrong')).status, 401);
    const packet = await (await call()).json() as any; assert.equal(packet.assignment.role, 'researcher'); assert.ok(packet.assignment.lease);
    const result = { assignment: packet.assignment.id, lease: packet.assignment.lease, hypothesis: 'Bounded hypothesis', code: 'class Strategy: pass', config: '{"config":{},"RMS":{}}' };
    assert.equal((await call({ ...result, worker: 'someone-else' })).status, 400);
    assert.equal((await call({ ...result, lease: 'stale' })).status, 400);
    const base = `http://127.0.0.1:${(office.server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'research-test' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); const messages: any[][] = [[], []];
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket(base.replace('http', 'ws') + '/ws?lite=1', { headers: { Cookie: cookie, Origin: base } }); sockets.push(ws);
      ws.on('message', data => messages[i].push(JSON.parse(data.toString())));
      await new Promise<void>((r, reject) => { ws.once('open', r); ws.once('error', reject); }); await wait(() => messages[i].some(m => m.t === 'welcome'));
    }
    assert.equal((await call(result)).status, 200); assert.equal((await call(result)).status, 200);
    await wait(() => messages.every(list => list.some(m => m.t === 'research.state' && m.view.state.experiments.length === 1)));
    for (const list of messages) {
      const state = list.find(m => m.t === 'research.state'); assert.equal(state.floor, floor.id); assert.ok(!JSON.stringify(state).includes('b'.repeat(64))); assert.ok(!state.view.state.assignments[0].lease);
    }
    // The same host-call registry supports remote floors; credentials stay on the host.
    const remote = new RemoteResearch(async (t, body) => researchHostCalls[t](floor, body), () => true);
    assert.equal((await remote.view()).state!.experiments.length, 1);
    await remote.action({ action: 'pause', campaign: view.state!.campaigns[0].id, paused: true }); assert.equal((await remote.view()).state!.campaigns[0].paused, true);
    await assert.rejects(new RemoteResearch(async () => ({}), () => false).view(), /Update the floor host/);
  } finally {
    sockets.forEach(ws => ws.close());
    for (const floor of office.floors()) for (const worker of floor.workers.list()) await floor.workers.kill(worker.id, 'keep');
    office.shutdown(); await new Promise<void>(r => coordinator.close(() => r()));
    await new Promise(r => setTimeout(r, 250)); rmSync(dir, { recursive: true, force: true });
  }
});
test('viewers cannot control campaigns through Office websocket handlers', async () => {
  const notes: string[] = [];
  const ctx = { floorOf: () => ({}), meOf: () => ({ admin: false }), warn: (_c: unknown, message: string) => notes.push(message) } as any;
  await researchHandlers['research.action'](ctx, {} as any, { t: 'research.action', body: { action: 'create', brief, requestId: 'one' } });
  assert.deepEqual(notes, ['Only admins can control research campaigns']);
});
