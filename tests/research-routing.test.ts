import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TeamRouter, type RoutedMeeting, type RoutingIO } from '../src/server/research-routing/router.js';
import { ResearchBridge, type Bridge, type QueueTask } from '../src/server/research-routing/bridge.js';
import { readRouting, saveRouting } from '../src/server/research-routing/storage.js';
import { childEnv } from '../src/server/workers/env.js';

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'research-routing-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const task: QueueTask = { id: 'task-1', candidate_id: 'candidate', department: 'edge-discovery', pattern: 'research.edge-discovery', version: 1, input: {} };
  const meetings = new Map<string, RoutedMeeting>(); let starts = 0, claims = 0, completions = 0;
  let lostStart = false, lostClaim = false, lostResult = false; let paused = false; let accepted = false;
  const bridge: Bridge = { async call<T>(op: string, body?: any): Promise<T> {
    if (op === 'health') return { schema_version: 1, capabilities: ['team-queues-v1'] } as T;
    if (op === 'ready') return { tasks: accepted ? [] : [task] } as T;
    if (op === 'claim') {
      claims++;
      if (lostClaim) { lostClaim = false; throw Error('Claim response lost'); }
      assert.equal(body.version, 1);
      return { ...task, version: 2, claim_token: 'claim-token', execution_key: 'execution-key' } as T;
    }
    if (op === 'heartbeat') return {} as T;
    if (op === 'complete') {
      if (!accepted) { completions++; accepted = true; }
      if (lostResult) { lostResult = false; throw Error('Completion response lost'); }
      return { state: 'done' } as T;
    }
    if (op === 'fail') return {} as T;
    throw Error(op);
  } };
  const io: RoutingIO = { allowed: () => paused ? 'Paused by administrator' : undefined,
    available: () => ![...meetings.values()].some(m => m.state === 'running'), find: key => meetings.get(key),
    async start(_task, key, id) { starts++; const m: RoutedMeeting = { id, key, state: 'running' }; meetings.set(key, m);
      if (lostStart) { lostStart = false; throw Error('Start response lost'); } return m; } };
  const router = () => new TeamRouter(file, bridge, io, 'floor-a');
  const retry = () => { const s = readRouting(file); for (const a of Object.values(s.attempts)) a.nextPoll = 0; saveRouting(file, s); };
  return { file, task, meetings, router, retry, counts: () => ({ starts, claims, completions }),
    loseStart: () => lostStart = true, loseClaim: () => lostClaim = true, loseResult: () => lostResult = true, pause: () => paused = true };
}

test('router persists claim/start and resumes the same meeting after restart', async t => {
  const f = fixture(t); await f.router().poll(); assert.equal(f.counts().starts, 1);
  await f.router().poll(); assert.equal(f.counts().starts, 1);
  const m = f.meetings.get('execution-key')!; m.state = 'done'; m.result = { meeting_id: m.id, outcome: 'propose' };
  await f.router().poll(); assert.equal(f.counts().completions, 1);
  assert.equal(readRouting(f.file).attempts['task-1'].state, 'done');
});

test('lost claim and start responses recover without duplicate meeting execution', async t => {
  const f = fixture(t); f.loseClaim(); await f.router().poll(); assert.equal(f.counts().starts, 0);
  f.retry(); f.loseStart(); await f.router().poll(); assert.equal(f.counts().starts, 1);
  f.retry(); await f.router().poll(); assert.equal(f.counts().starts, 1);
  assert.equal(readRouting(f.file).attempts['task-1'].state, 'running');
});

test('completion is retried from the durable result even if the room was cleared', async t => {
  const f = fixture(t); await f.router().poll(); const m = f.meetings.get('execution-key')!;
  m.state = 'done'; m.result = { meeting_id: m.id }; f.loseResult(); await f.router().poll();
  f.meetings.clear(); f.retry(); await f.router().poll();
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().completions, 1);
  assert.equal(readRouting(f.file).attempts['task-1'].state, 'done');
});

test('unknown start outcomes are held, not replayed; revoked authorization prevents dispatch', async t => {
  const f = fixture(t);
  saveRouting(f.file, { version: 1, attempts: { [f.task.id]: { task: { ...f.task, claim_token: 'token', execution_key: 'execution-key' }, claimKey: 'key', state: 'starting' } } });
  await f.router().poll(); assert.equal(readRouting(f.file).attempts['task-1'].state, 'unresolved');
  f.retry(); await f.router().poll(); assert.equal(f.counts().starts, 0);
  const other = fixture(t); other.pause(); await other.router().poll(); assert.equal(other.counts().claims, 0);
});

test('bridge refuses non-loopback endpoints and controller secrets are scrubbed from worker environments', () => {
  for (const endpoint of ['https://127.0.0.1/research/v1/', 'http://example.com/research/v1/', 'http://127.0.0.1/other', 'http://x:y@127.0.0.1/research/v1/'])
    assert.throws(() => new ResearchBridge(endpoint, 'floor', 'x'.repeat(32)));
  process.env.AGENT_OFFICE_RESEARCH_BRIDGE_TOKEN = 'fixture-controller-secret';
  try { assert.equal(childEnv().AGENT_OFFICE_RESEARCH_BRIDGE_TOKEN, undefined); }
  finally { delete process.env.AGENT_OFFICE_RESEARCH_BRIDGE_TOKEN; }
});

import { mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installResearchRouting, closeResearchRouting } from '../src/server/research-routing/service.js';
import type { Floor, FloorContext } from '../src/server/floor.js';
import { strategySource } from '../src/server/meeting-patterns/source.js';
import { createHash } from 'node:crypto';
test('startup never removes another controller lock and graceful shutdown releases only its own', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'research-service-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir }); mkdirSync(path.join(dir, '.agent-office'));
  const config = path.join(dir, '.agent-office/research-routing.json');
  writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:8765/research/v1/', tokenEnv: 'AGENT_OFFICE_TEST_RESEARCH', maxMeetings: 1 }), { mode: 0o600 });
  const lock = path.join(dir, '.agent-office/research-routing.lock'); mkdirSync(lock);
  process.env.AGENT_OFFICE_TEST_RESEARCH = 'x'.repeat(40);
  const floor = { def: { dir }, id: 'fixture' } as Floor;
  const notices: string[] = []; const ctx = { toast: (_f: unknown, message: string) => notices.push(message) } as FloorContext;
  try {
    installResearchRouting(floor, ctx); assert.ok(existsSync(lock)); assert.match(notices[0], /disabled/);
    rmSync(lock, { recursive: true }); installResearchRouting(floor, ctx); assert.ok(existsSync(lock));
    closeResearchRouting(floor); assert.equal(existsSync(lock), false);
  } finally { delete process.env.AGENT_OFFICE_TEST_RESEARCH; closeResearchRouting(floor); }
});

test('source transfer checks digests and refuses paths and symlinks outside the meeting', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'research-source-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'meeting'); mkdirSync(cwd); const code = 'class Strategy: pass\n';
  const sha = createHash('sha256').update(code).digest('hex'); writeFileSync(path.join(cwd, 'strategy.py'), code);
  assert.equal(strategySource(cwd, { details: { source_path: 'strategy.py', source_digest: sha } }), code);
  writeFileSync(path.join(dir, 'outside.py'), code); symlinkSync(path.join(dir, 'outside.py'), path.join(cwd, 'link.py'));
  assert.throws(() => strategySource(cwd, { details: { source_path: '../outside.py', source_digest: sha } }));
  assert.throws(() => strategySource(cwd, { details: { source_path: 'link.py', source_digest: sha } }));
  assert.throws(() => strategySource(cwd, { details: { source_path: 'strategy.py', source_digest: 'wrong' } }));
});
