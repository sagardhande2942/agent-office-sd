import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { LoreStore } from '../src/server/lore.js';
import { HostFloors, hostParts, startHooks } from '../src/server/host-floor.js';
import type { FromFloor } from '../src/shared/floorhost.js';

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(predicate(), 'Expected worker lifecycle evidence within five seconds');
}
function fakeClaude(dir: string) {
  const command = path.join(dir, 'claude'), log = path.join(dir, 'launch.jsonl');
  writeFileSync(command, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');\nif(process.argv.includes('-p') || process.argv.includes('--print')) { console.log(JSON.stringify({name:'Auth tests',summary:'Fix auth tests'})); process.exit(0); }\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
  return { command, log };
}

test('real workers receive lore, own authenticated discoveries, broadcast handovers and preserve them on departure', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-worker-lore-'));
  const { command, log } = fakeClaude(dir);
  const cfg = loadConfig([dir, '--password', 'worker-lore-test', '--no-open', '--agent', command]); cfg.port = 0;
  const office = await startServer(cfg);
  let ws: WebSocket | undefined;
  try {
    const floor = office.floors()[0]; await floor.ready;
    floor.lore.save({ title: 'Auth fixture setup', content: 'Verified: use TEST_DB for isolated auth fixtures', author: 'Previous worker', tags: ['auth'] });
    const ada = floor.workers.spawn('desk-1', 'tester', 'Fix auth tests', false, 'agent', 'claude');
    assert.ok(typeof ada !== 'string', String(ada));
    await waitFor(() => { try { return readFileSync(log, 'utf8').includes('TEST_DB'); } catch { return false; } });
    assert.match(readFileSync(log, 'utf8'), /office-workers lore save/);
    const token = JSON.parse(readFileSync(path.join(dir, '.agent-office/workers.json'), 'utf8')).find((w: any) => w.id === ada.id).hookToken;
    const call = async (action: string, body?: object, bearer = token) => {
      const res = await fetch(`http://127.0.0.1:${office.hookPort}/office/workers/${action}?worker=${ada.id}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await call('lore', undefined, 'wrong')).status, 401);
    assert.equal((await call('lore', { title: 'Spoof', content: 'No', author: 'Other floor' })).status, 400);
    assert.equal((await call('lore', { title: 'Unsafe', content: 'No', id: '../workers' })).status, 400);
    const knowledge = await call('lore', { title: 'Auth timeout fix', content: 'Observed and tested: reset the auth clock between cases.', tags: ['auth'] });
    assert.equal(knowledge.status, 200); assert.equal(knowledge.body.note.workerId, ada.id); assert.equal(knowledge.body.note.author, ada.name);
    const corrected = await call('lore', { title: 'auth timeout fix', content: 'Verified correction: reset the clock after each case.', tags: ['auth'] });
    assert.equal(corrected.body.note.id, knowledge.body.note.id);
    assert.ok((await call('lore')).body.notes.some((n: any) => n.id === knowledge.body.note.id));
    const revision = (await call('completion')).body.revision;
    const port = (office.server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
    const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'worker-lore-test' }) });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const observed: any[] = [];
    ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws?lite=1', { headers: { Origin: origin, Cookie: cookie } });
    ws.on('message', raw => observed.push(JSON.parse(String(raw))));
    await waitFor(() => observed.some(m => m.t === 'welcome'));
    const report = { revision, summary: 'Auth timeout fixed', checks: [{ name: 'Auth tests', status: 'passed', evidence: '12 tests passed' }], files: ['tests/auth.ts'], prNote: 'Local test fixture' };
    assert.equal((await call('complete', { ...report, revision: revision + 1 })).status, 400);
    assert.equal(floor.lore.list().filter(n => n.tags.includes('handover')).length, 0);
    assert.equal((await call('complete', report)).status, 200);
    await waitFor(() => observed.some(m => m.t === 'lore.saved' && m.note.tags.includes('handover')));
    const handover = floor.lore.list().find(n => n.tags.includes('handover'))!;
    assert.equal(handover.workerId, ada.id); assert.match(handover.content, /12 tests passed/);
    assert.ok(new LoreStore(path.join(dir, '.agent-office')).list().some(n => n.id === handover.id));
    await floor.workers.kill(ada.id, 'keep');
    assert.equal(floor.lore.list().filter(n => n.tags.includes('handover')).length, 1);
    assert.equal((await call('lore')).status, 401, 'retired workers cannot keep writing knowledge');
    const next = floor.workers.spawn('desk-1', 'tester', 'Continue auth work', false, 'agent', 'claude');
    assert.ok(typeof next !== 'string');
    await waitFor(() => readFileSync(log, 'utf8').includes('reset the clock after each case'));
    await floor.workers.kill(next.id, 'keep');
    assert.ok(floor.lore.list().some(n => /completion is unverified/.test(n.content)));
  } finally {
    ws?.terminate(); office.shutdown(); await new Promise(resolve => setTimeout(resolve, 300)); rmSync(dir, { recursive: true, force: true });
  }
});

test('floor-host workers save discoveries and completion handovers on host-local disk', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'host-worker-lore-'));
  const project = path.join(dir, 'project'); mkdirSync(project);
  const { command } = fakeClaude(dir);
  let host: HostFloors | undefined;
  const sent: FromFloor[] = [];
  const hooks = await startHooks(id => host?.workersOf(id), { floorOf: id => host?.floorOf(id), changed: () => {}, publish: (floor, msg) => host?.reportWorkerFeature(floor.id, msg) });
  try {
    host = new HostFloors(hostParts({ dataDir: path.join(dir, 'host-data'), agentCmd: command, agentArgs: [], dshProfile: 'acp' }, msg => sent.push(msg), hooks.url, 2));
    await host.open([{ id: 'hosted', name: 'Hosted', dir: project }]);
    // The host routes worker lookup through its ordinary lifecycle updates.
    const floor = (host as any).floors.get('hosted');
    const ada = floor.workers.spawn('desk-1', 'tester', 'Fix hosted auth', false, 'agent', 'claude'); assert.ok(typeof ada !== 'string');
    const token = JSON.parse(readFileSync(path.join(project, '.agent-office/workers.json'), 'utf8')).find((w: any) => w.id === ada.id).hookToken;
    const call = async (action: string, body?: object) => {
      const res = await fetch(`${hooks.url}/office/workers/${action}?worker=${ada.id}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await call('lore', { title: 'Host auth setup', content: 'Verified on this host', tags: ['auth'] })).status, 200);
    const revision = (await call('completion')).body.revision;
    assert.equal((await call('complete', { revision, summary: 'Host work ready', checks: [{ name: 'Host tests', status: 'passed', evidence: '4 passed' }], files: [], filesNote: 'Research', prNote: 'No code change' })).status, 200);
    assert.equal(new LoreStore(path.join(project, '.agent-office')).list().length, 2);
    assert.ok(sent.some(msg => msg.t === 'event' && (msg.msg as any).t === 'lore.saved' && (msg.msg as any).note.tags.includes('handover')));
    assert.ok(sent.some(msg => msg.t === 'ready' && msg.floor.lore === true));
  } finally { host?.shutdown(); hooks.close(); await new Promise(resolve => setTimeout(resolve, 300)); rmSync(dir, { recursive: true, force: true }); }
});
