import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { spawn } from '@lydell/node-pty';

// Exercise real raw terminal input so Enter cannot leak into a worker during attachment.
test('dashboard navigation, terminal input, floor switching and cleanup over a PTY', { timeout: 20_000 }, async () => {
  const server = http.createServer((req, res) => {
    // The live office may discover ephemeral local servers while this fixture runs.
    if (req.url === '/') { res.writeHead(404); res.end(); return; }
    assert.equal(req.url, '/api/login');
    res.writeHead(200, { 'set-cookie': 'ao_session=test; HttpOnly' }); res.end('{}');
  });
  const wss = new WebSocketServer({ server });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const messages: { t: string; data?: string; floor?: string }[] = [];
  const view = {
    floor: 'test', project: { dir: '/project' }, plan: { wing: 0, labels: {} },
    workers: [{ id: 'w1', deskId: 'desk-1', name: 'Ada', status: 'needs_input', provider: 'codex', worktree: { path: '/project/ada', branch: 'office/ada', base: 'main' } }],
    issues: { items: [{ number: 12, title: 'Fix login' }] }, pulls: { items: [] }, queue: { tasks: [] },
  };
  wss.on('connection', (ws, req) => {
    assert.equal(req.headers.cookie, 'ao_session=test');
    assert.equal(req.headers.origin, `http://localhost:${port}`);
    ws.send(JSON.stringify({ t: 'welcome', ...view, floors: [{ id: 'test', name: 'Office' }, { id: 'api', name: 'API' }] }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)); messages.push(msg);
      if (msg.t === 'worker.attach') ws.send(JSON.stringify({ t: 'term.snapshot', workerId: 'w1', cols: 120, rows: 30, data: '\x1b[?1049h' + Array.from({ length: 80 }, (_, i) => `HISTORY_ROW_${i}\r\n`).join('') + 'TERMINAL_READY\r\n' }));
      if (msg.t === 'term.input') ws.send(JSON.stringify({ t: 'term.data', workerId: 'w1', data: 'INPUT_RECEIVED\r\n' }));
      if (msg.t === 'floor.go') ws.send(JSON.stringify({ t: 'floor.enter', ...view, floor: msg.floor }));
    });
  });
  const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('src/server/cli.ts'), 'tui', '--office', `http://localhost:${port}`], {
    name: 'xterm-256color', cols: 120, rows: 30, cwd: process.cwd(), env: { ...process.env, AGENT_OFFICE_PASSWORD: 'test' },
  });
  let output = '';
  child.onData((data) => { output += data; });
  const exited = new Promise<number>((resolve) => child.onExit((event) => resolve(event.exitCode)));
  const expect = async (text: string) => {
    const deadline = Date.now() + 5000;
    while (!output.includes(text) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(output.includes(text), `Missing terminal output: ${text}`);
    const seen = output; output = ''; return seen;
  };
  try {
    await expect('Ada'); child.write('\r'); await expect('TERMINAL_READY');
    child.write('\x1b[5~'); await expect('HISTORY_ROW_23');
    child.write('\x1b[<64;2;3M'); const scrolled = await expect('HISTORY_ROW_20');
    if (process.env.TUI_SCROLL_EVIDENCE) writeFileSync(process.env.TUI_SCROLL_EVIDENCE, scrolled);
    child.write('\x1b[6~\x1b[6~'); await expect('TERMINAL_READY');
    child.write('hello\x03'); await expect('INPUT_RECEIVED');
    child.write('\x1d'); await expect('AGENT OFFICE');
    child.write('i'); await expect('Fix login');
    child.write('f'); await expect('[FLOORS]');
    child.write('\x1b[B\r'); await expect('AGENT OFFICE / API');
    child.resize(32, 12); await expect('AGENT OFFICE');
    child.resize(120, 30); await expect('AGENT OFFICE');
    child.write('x'); await expect('Keep both');
    child.write('\x1b'); await expect('AGENT OFFICE');
    assert.equal(messages.filter((m) => m.t === 'worker.kill').length, 0);
    child.write(':home w1 --cleanup invalid\r'); await expect('Usage: home');
    assert.equal(messages.filter((m) => m.t === 'worker.kill').length, 0);
    child.write('x'); await expect('Keep both');
    child.write('2\r'); await expect('Sending Ada home');
    child.write(':home Ada --cleanup keep\r'); await expect('Sending Ada home');
    child.write('q'); assert.equal(await exited, 0);
    assert.deepEqual(messages.filter((m) => m.t === 'worker.kill'), [
      { t: 'worker.kill', workerId: 'w1', cleanup: 'worktree' },
      { t: 'worker.kill', workerId: 'w1', cleanup: 'keep' },
    ]);
    assert.deepEqual(messages.filter((m) => m.t === 'term.input').map((m) => m.data), ['hello\x03']);
    assert.ok(messages.some((m) => m.t === 'worker.detach'));
    assert.ok(messages.some((m) => m.t === 'floor.go' && m.floor === 'api'));
  } finally {
    try { child.kill(); } catch { /* Already exited. */ }
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
