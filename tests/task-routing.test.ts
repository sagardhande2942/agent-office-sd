import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TeamRouter, type RoutedMeeting, type RoutingIO } from '../src/server/task-routing/router.js';
import { TaskBridge, type Bridge, type QueueTask } from '../src/server/task-routing/bridge.js';
import { readRouting, saveRouting } from '../src/server/task-routing/storage.js';
import { childEnv } from '../src/server/workers/env.js';

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-routing-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const task: QueueTask = { id: 'task-1', group: 'documentation', title: 'Review documentation', workflow: DEFAULT_WORKFLOW, version: 1, input: {} };
  const meetings = new Map<string, RoutedMeeting>(); let starts = 0, claims = 0, completions = 0;
  let lostStart = false, lostClaim = false, lostResult = false; let paused = false; let accepted = false; let changedClaim = false, changedAgent = false;
  const bridge: Bridge = { async call<T>(op: string, body?: any): Promise<T> {
    if (op === 'health') return { schema_version: 1, capabilities: ['meeting-tasks-v1'] } as T;
    if (op === 'ready') return { tasks: accepted ? [] : [task] } as T;
    if (op === 'claim') {
      claims++;
      if (lostClaim) { lostClaim = false; throw Error('Claim response lost'); }
      assert.equal(body.version, 1);
      return { ...task, ...(changedClaim ? {group:'different-team'} : {}), ...(changedAgent ? {agent:{provider:'opencode',model:'opencode/glm-5.3-flash-free'}} : {}), version: 2, claim_token: 'claim-token', execution_key: 'execution-key' } as T;
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
    loseStart: () => lostStart = true, loseClaim: () => lostClaim = true, loseResult: () => lostResult = true, pause: () => paused = true, changeClaim: () => changedClaim = true, changeAgent: () => changedAgent = true };
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
  for (const endpoint of ['https://127.0.0.1/tasks/v1/', 'http://example.com/tasks/v1/', 'http://127.0.0.1/other', 'http://x:y@127.0.0.1/tasks/v1/'])
    assert.throws(() => new TaskBridge(endpoint, 'floor', 'x'.repeat(32)));
  process.env.AGENT_OFFICE_TASK_BRIDGE_TOKEN = 'fixture-controller-secret';
  try { assert.equal(childEnv().AGENT_OFFICE_TASK_BRIDGE_TOKEN, undefined); }
  finally { delete process.env.AGENT_OFFICE_TASK_BRIDGE_TOKEN; }
});

import { mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installTaskRouting, closeTaskRouting } from '../src/server/task-routing/service.js';
import type { Floor, FloorContext } from '../src/server/floor.js';
import { resolveAttachments } from '../src/server/meeting-patterns/attachments.js';
import { DEFAULT_WORKFLOW, type FileAttachment } from '../src/shared/meeting-workflows.js';
import { createHash } from 'node:crypto';
test('startup never removes another controller lock and graceful shutdown releases only its own', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-service-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir }); mkdirSync(path.join(dir, '.agent-office'));
  const config = path.join(dir, '.agent-office/task-routing.json');
  writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:8765/tasks/v1/', tokenEnv: 'AGENT_OFFICE_TEST_TASKS', maxMeetings: 1 }), { mode: 0o600 });
  const lock = path.join(dir, '.agent-office/task-routing.lock'); mkdirSync(lock);
  process.env.AGENT_OFFICE_TEST_TASKS = 'x'.repeat(40);
  const floor = { def: { dir }, id: 'fixture' } as Floor;
  const notices: string[] = []; const ctx = { toast: (_f: unknown, message: string) => notices.push(message) } as FloorContext;
  try {
    installTaskRouting(floor, ctx); assert.ok(existsSync(lock)); assert.match(notices[0], /disabled/);
    rmSync(lock, { recursive: true }); installTaskRouting(floor, ctx); assert.ok(existsSync(lock));
    closeTaskRouting(floor); assert.equal(existsSync(lock), false);
  } finally { delete process.env.AGENT_OFFICE_TEST_TASKS; closeTaskRouting(floor); }
});

test('declared file attachments check digests and refuse outside paths and symlinks', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meeting-attachment-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'meeting'); mkdirSync(cwd); const content = 'Reviewed document\n';
  const sha = createHash('sha256').update(content).digest('hex'); writeFileSync(path.join(cwd, 'document.txt'), content);
  const attachments: FileAttachment[] = [{ path:'document.path',content:'document.text',sha256:'document.digest',maxBytes:200000 }];
  const output = (file:string,digest=sha) => ({ document: { path:file,digest } });
  assert.equal((resolveAttachments(cwd,output('document.txt'),attachments).document as any).text, content);
  writeFileSync(path.join(dir,'outside.txt'),content); symlinkSync(path.join(dir,'outside.txt'),path.join(cwd,'link.txt'));
  assert.throws(()=>resolveAttachments(cwd,output('../outside.txt'),attachments));
  assert.throws(()=>resolveAttachments(cwd,output('link.txt'),attachments));
  assert.throws(()=>resolveAttachments(cwd,output('document.txt','wrong'),attachments));
  assert.throws(()=>resolveAttachments(cwd,output('document.txt'),attachments,true));
});

test('malformed tasks and changed claim definitions cannot start paid meetings', async t => {
  const bad=fixture(t); bad.task.workflow={...DEFAULT_WORKFLOW,roles:[]} ; await bad.router().poll();
  assert.equal(bad.counts().claims,0); assert.equal(bad.counts().starts,0);
  const changed=fixture(t); changed.changeClaim(); await changed.router().poll();
  assert.equal(changed.counts().starts,0); assert.match(readRouting(changed.file).attempts['task-1'].error!,/changed claim/);
  changed.retry(); await changed.router().poll(); assert.equal(changed.counts().starts,0);
});

test('worker tasks wait without claiming when a bridge lacks the worker capability',async t=>{
  const f=fixture(t);f.task.execution='worker';f.task.workflow=structuredClone(DEFAULT_WORKFLOW);
  f.task.workflow.roles=['Writer'];f.task.workflow.stages=[{label:'Task',turns:[{seats:[0],output:true,prompt:'Write the result'}]}];
  await f.router().poll();await f.router().poll();assert.deepEqual(f.counts(),{starts:0,claims:0,completions:0});
});

test('claim identity refuses a provider switch after ready',async t=>{
  const f=fixture(t);f.task.agent={provider:'codex'};f.changeAgent();await f.router().poll();assert.equal(f.counts().starts,0);
});
