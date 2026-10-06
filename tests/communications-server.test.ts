import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { WebSocket } from 'ws';

test('authenticated workers coordinate without prompting and observers receive persistent receipts', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-message-server-'));
  const cfg = loadConfig([dir, '--password', 'test-inbox', '--no-open', '--agent', process.execPath]);
  cfg.port = 0; cfg.agentArgs = ['-e', 'setInterval(() => {}, 1000)'];
  const office = await startServer(cfg);
  let ws: WebSocket | undefined;
  try {
    const floor = office.floors()[0]; await floor.ready;
    const ada = await floor.workers.spawn('desk-1', 'tester', undefined, false, 'agent', 'custom');
    const grace = await floor.workers.spawn('desk-2', 'tester', undefined, false, 'agent', 'custom');
    assert.ok(typeof ada !== 'string' && typeof grace !== 'string');
    const saved = JSON.parse(readFileSync(path.join(dir, '.agent-office/workers.json'), 'utf8'));
    const token = (id: string) => saved.find((w: { id: string }) => w.id === id).hookToken;
    const port = (office.server.address() as { port: number }).port;
    const origin = `http://localhost:${port}`;
    const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-inbox' }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const observed: any[] = [];
    ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws?lite=1', { headers: { Origin: origin, Cookie: cookie } });
    ws.on('message', (raw) => observed.push(JSON.parse(String(raw))));
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(predicate());
    };
    await waitFor(() => observed.some((m) => m.t === 'welcome'));
    const call = async (id: string, action: string, body?: object, suppliedToken = token(id)) => {
      const res = await fetch(`http://127.0.0.1:${office.hookPort}/office/workers/${action}?worker=${id}`, {
        method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${suppliedToken}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await call(ada.id, 'inbox', undefined, 'bad')).status, 401);
    // Any attempt to interrupt a terminal fails the test, including wake-up through resume.
    floor.workers.prompt = async () => { throw new Error('Tracked messages must never prompt workers'); };
    floor.workers.resume = () => { throw new Error('Tracked messages must never wake workers'); };
    const request = await call(grace.id, 'request', { worker: ada.id, prompt: 'What fields will /users return?', key: 'users' });
    assert.equal(request.status, 200); assert.equal(request.body.message.status, 'pending');
    const id = request.body.message.id;
    const retry = await call(grace.id, 'request', { worker: ada.id, prompt: 'What fields will /users return?', key: 'users' });
    assert.equal(retry.body.message.id, id);
    assert.equal((await call(grace.id, 'ack', { id })).status, 400, 'sender cannot claim recipient read it');
    assert.equal((await call(ada.id, 'inbox')).body.messages[0].status, 'delivered');
    const reply = await call(ada.id, 'reply', { id, prompt: '{ id, name }', context: { branch: 'api/users', commit: 'abcdef1', files: ['users.ts'] }, key: 'reply' });
    assert.equal(reply.status, 200);
    assert.equal((await call(grace.id, 'ack', { id: reply.body.message.id })).status, 200);
    await waitFor(() => observed.some((m) => m.t === 'communications' && m.state.messages.some((r: any) => r.id === id && r.status === 'completed')));
    const inbox = await call(grace.id, 'inbox');
    assert.equal(inbox.body.messages.find((m: any) => m.id === id).status, 'completed');
    const shell = await floor.workers.spawn('desk-3', 'tester', undefined, false, 'shell'); assert.ok(typeof shell !== 'string');
    assert.equal((await call(grace.id, 'request', { worker: shell.id, prompt: 'Never execute this' })).status, 400);
    assert.equal((await call(grace.id, 'request', { worker: 'another-floor-worker', prompt: 'Wrong floor' })).status, 400);
  } finally {
    ws?.terminate(); office.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
