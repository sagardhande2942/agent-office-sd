import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Ctx } from '../src/server/office/context.js';
import { taskBriefRoutes } from '../src/server/task-brief/routes.js';
import { requestHandler } from '../src/server/http/router.js';

test('AI routes require session and same origin, bound concurrency, and return a draft without touching floors', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'brief-routes-'));
  const output = { goal: 'Fix deletion', examples: '', constraints: 'Keep checkout', acceptance: 'The row disappears', assumptions: '', questions: '' };
  const script = `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(output))}),600));`;
  let command = path.join(dir, 'codex');
  if (process.platform === 'win32') {
    command += '.cmd'; writeFileSync(command, '');
    const entry = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(path.dirname(entry), { recursive: true }); writeFileSync(entry, script);
  } else { writeFileSync(command, `#!${process.execPath}\n${script}`); chmodSync(command, 0o755); }
  let paused: string | undefined;
  const ctx = {
    cfg: { agentCmd: command, port: 0, trustProxy: false },
    auth: { fromRequest: (req: http.IncomingMessage) => req.headers.cookie === 'test=session' ? {} : undefined },
    signins: { ready: () => false, why: () => 'Sign in to Claude first' },
    ledger: { get hiringPaused() { return paused; }, add: () => {} },
  } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, Object.values(taskBriefRoutes)));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  ctx.cfg.port = (server.address() as import('node:net').AddressInfo).port;
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const request = { provider: 'codex', maxLength: 20000, brief: { original: 'Fix deletion', goal: '', examples: '', constraints: 'Keep checkout', acceptance: '', assumptions: '', questions: '' } };
  const post = (body: unknown = request, origin = base) => fetch(base + '/api/task-brief/draft', { method: 'POST', headers: { cookie: 'test=session', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/task-brief/options')).status, 401);
    assert.equal((await fetch(base + '/api/task-brief/draft', { method: 'POST', body: JSON.stringify(request) })).status, 401);
    assert.equal((await post(request, 'https://other.example')).status, 403);
    assert.equal((await post({ ...request, provider: 'shell' })).status, 400);
    const options = await (await fetch(base + '/api/task-brief/options', { headers: { cookie: 'test=session' } })).json() as { providers: { id: string; available: boolean }[] };
    assert.equal(options.providers.find(p => p.id === 'codex')?.available, true);
    paused = 'Budget spent'; assert.equal((await post()).status, 429); paused = undefined;
    const first = post();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await post()).status, 429);
    const response = await first; assert.equal(response.status, 200);
    const result = await response.json() as { brief: { original: string; constraints: string } };
    assert.equal(result.brief.original, request.brief.original);
    assert.equal(result.brief.constraints, output.constraints);
    assert.equal((await post()).status, 200, 'the slot is released after completion');
    const controller = new AbortController();
    const interrupted = fetch(base + '/api/task-brief/draft', { method: 'POST', signal: controller.signal,
      headers: { cookie: 'test=session', origin: base, 'content-type': 'application/json' }, body: JSON.stringify(request) });
    // Attach the rejection handler before aborting so the test cannot leak an unhandled rejection.
    const ended = assert.rejects(interrupted, error => error instanceof Error && error.name === 'AbortError');
    await new Promise(resolve => setTimeout(resolve, 150)); controller.abort(); await ended;
    let next: Response | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50)); next = await post();
      if (next.status !== 429) break;
    }
    assert.equal(next?.status, 200, 'disconnecting stops the process and releases the account slot');
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
