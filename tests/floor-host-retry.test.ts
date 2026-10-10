import { runFloorHost } from '../src/server/floor-join/reconnect';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RETRY_WINDOW_MS, retryConnection } from '../src/server/floor-join/retry';
import { connectOnce } from '../src/server/floor-join/connection';
import { WebSocketServer } from 'ws';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('network failures retry for ten full minutes with capped backoff', async () => {
  let now = 0, attempts = 0;
  const waits: number[] = [];
  const code = await retryConnection(async () => { attempts++; return { code: 1, retry: true }; }, new AbortController().signal, {
    now: () => now, wait: async ms => { waits.push(ms); now += ms; },
  });
  assert.equal(code, 1); assert.equal(now, RETRY_WINDOW_MS);
  assert.ok(attempts > 40); assert.deepEqual(waits.slice(0, 5), [1000, 2000, 4000, 8000, 15000]);
  assert.ok(waits.every(ms => ms <= 15000));
});

test('an authenticated reconnect starts a fresh ten-minute window for the next outage', async () => {
  let now = 0, calls = 0, authenticatedAt = 0;
  await retryConnection(async authenticated => {
    if (++calls === 15) { authenticatedAt = now; authenticated(); }
    return { code: 1, retry: true };
  }, new AbortController().signal, { now: () => now, wait: async ms => { now += ms; } });
  assert.equal(now - authenticatedAt, RETRY_WINDOW_MS);
});

test('refusal and Ctrl+C stop without another connection attempt', async () => {
  let attempts = 0;
  assert.equal(await retryConnection(async () => { attempts++; return { code: 1, retry: false }; }, new AbortController().signal), 1);
  assert.equal(attempts, 1);
  const controller = new AbortController();
  assert.equal(await retryConnection(async () => ({ code: 1, retry: true }), controller.signal, { wait: async () => controller.abort() }), 0);
});

test('real socket refusal is terminal; normal office shutdown requests a retry', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  let reason: string | undefined = 'invalid token';
  server.on('connection', ws => ws.once('message', () => ws.send(JSON.stringify({ t: 'bye', why: reason }))));
  const opts = { token: 'test-token', configFile: path.join(tmpdir(), 'unused-floorhost-test.json'), seats: 0, projects: tmpdir() };
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  assert.deepEqual(await connectOnce(url, opts, new AbortController().signal, () => {}), { code: 1, retry: false });
  reason = undefined;
  assert.deepEqual(await connectOnce(url, opts, new AbortController().signal, () => {}), { code: 1, retry: true });
});

test('a received pairing token is saved and replaces the one-use code on subsequent attempts', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floorhost-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const hellos: { token?: string; code?: string }[] = [];
  server.on('connection', ws => ws.once('message', raw => {
    hellos.push(JSON.parse(String(raw)));
    // A join error avoids launching real floors, but the freshly claimed credential must survive it.
    ws.send(JSON.stringify({ t: 'welcome', hostId: 'machine-1', token: 'saved-credential', floors: [], joinError: 'fixture join error' }));
  }));
  const opts = { code: 'ONE-USE', configFile: path.join(dir, 'host.json'), seats: 0, projects: dir, token: undefined as string | undefined };
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  await connectOnce(url, opts, new AbortController().signal, () => {});
  assert.equal(JSON.parse(readFileSync(opts.configFile, 'utf8')).token, 'saved-credential');
  await connectOnce(url, opts, new AbortController().signal, () => {});
  assert.equal(hellos[0].code, 'ONE-USE'); assert.equal(hellos[1].token, 'saved-credential'); assert.equal(hellos[1].code, undefined);
});

test('the real reconnect loop reuses the token and releases process signal handlers', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floorhost-reconnect-loop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const before = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
  const hellos: { token?: string; code?: string }[] = [];
  server.on('connection', ws => ws.once('message', raw => {
    hellos.push(JSON.parse(String(raw)));
    if (hellos.length === 1) {
      // Server shuts down during startup, before floor opening finishes.
      ws.send(JSON.stringify({ t: 'welcome', hostId: 'same-machine', token: 'retained-token', floors: [] }));
      ws.send(JSON.stringify({ t: 'bye' }));
    } else ws.send(JSON.stringify({ t: 'bye', why: 'fixture finished' }));
  }));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/floor-host`;
  assert.equal(await runFloorHost(url, { code: 'FIRST-CODE', configFile: path.join(dir, 'host.json'), seats: 0, projects: dir }), 1);
  assert.equal(hellos.length, 2); assert.equal(hellos[1].token, 'retained-token'); assert.equal(hellos[1].code, undefined);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), before);
});
