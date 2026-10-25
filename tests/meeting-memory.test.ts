import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_WORKFLOW } from '../src/shared/meeting-workflows.js';
import type { Floor } from '../src/server/floor.js';
import type { Meeting, WorkerInfo } from '../src/shared/protocol.js';
import { KnowledgeStore } from '../src/server/knowledge/store.js';
import { floorWorkerKnowledge } from '../src/server/knowledge/hooks.js';
import { meetingMemoryContext, meetingMemoryGate, recordMeetingReview, observationPrefix } from '../src/server/knowledge/meetings.js';

function fixture(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-memory-'));
  const store = new KnowledgeStore(dir); store.seed();
  const m = { id: 'session-a', pattern: 'custom', workflow: DEFAULT_WORKFLOW, status: 'running', prompt: 'Investigate document references',
    output: 'results/result.json', seats: [{ workerId: 'chair' }, { workerId: 'peer' }] } as Meeting;
  const chair = { id: 'chair', kind: 'agent', meeting: m.id } as WorkerInfo;
  const peer = { id: 'peer', kind: 'agent', meeting: m.id } as WorkerInfo;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = (text = '{"findings":"initial"}') => {
    fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
    fs.writeFileSync(path.join(dir, m.output), text); fs.writeFileSync(path.join(dir, m.output + '.md'), '# Evidence');
  };
  return { dir, store, m, chair, peer, output };
}

test('all seats share a frozen bounded packet; later sessions see newer versioned summaries', t => {
  const f = fixture(t);
  f.store.write('meetings/costs.md', { title: 'Document references', summary: 'Original reference assumptions', pinned: true }, 'Detailed evidence', 'worker:fixture');
  const first = meetingMemoryContext(f.dir, f.m);
  assert.match(first, /Original reference assumptions/); assert.match(first, /version /);
  assert.ok(first.length < 4200);
  const note = f.store.read('meetings/costs.md');
  f.store.write('meetings/costs.md', { summary: 'Updated reference assumptions' }, 'New details', 'worker:other', note.version);
  assert.equal(meetingMemoryContext(f.dir, f.m), first);
  assert.match(meetingMemoryContext(f.dir, { ...f.m, id: 'session-b' }), /Updated reference assumptions/);
  f.store.write('meetings/unverified.md', { title: 'Document references', summary: 'UNVERIFIED SECRET SUMMARY', status: 'needs-verification', pinned: true }, 'Observation', 'worker:fixture');
  assert.doesNotMatch(meetingMemoryContext(f.dir, { ...f.m, id: 'session-c' }), /UNVERIFIED SECRET SUMMARY/);
});

test('review binds session chair, packet, exact outputs and changed note versions across restarts', t => {
  const f = fixture(t); meetingMemoryContext(f.dir, f.m);
  assert.match(meetingMemoryGate(f.dir, f.m)!, /Knowledge review required/);
  assert.throws(() => recordMeetingReview(f.dir, f.m, f.peer, [], 'Nothing new'), /chair/);
  assert.throws(() => recordMeetingReview(f.dir, f.m, f.chair, [], 'Nothing new'), /final output/);
  f.output(); assert.throws(() => recordMeetingReview(f.dir, f.m, f.chair, [], ''), /none_reason/);
  recordMeetingReview(f.dir, f.m, f.chair, [], 'No durable lessons beyond current evidence');
  assert.equal(meetingMemoryGate(f.dir, f.m), undefined);
  assert.match(meetingMemoryGate(f.dir, { ...f.m, seats: [{ workerId: 'replacement' }] } as Meeting)!, /required/);
  f.output('{"findings":"changed"}'); assert.match(meetingMemoryGate(f.dir, f.m)!, /required/);
  const p = observationPrefix(f.m) + 'costs.md';
  f.store.write(p, { title: 'Costs', summary: 'Observed sensitivity', status: 'needs-verification' }, 'Run-1 evidence', 'worker:fixture');
  recordMeetingReview(f.dir, f.m, f.chair, [p], undefined);
  assert.equal(meetingMemoryGate(f.dir, f.m), undefined);
  const prior = f.store.read(p); f.store.write(p, {}, 'Changed finding', 'worker:chair', prior.version);
  assert.match(meetingMemoryGate(f.dir, f.m)!, /required/);
  assert.throws(() => recordMeetingReview(f.dir, f.m, f.chair, ['meetings/other.md'], undefined), /observation/);
});

test('review policy is frozen and legacy meetings are unaffected', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, '.agent-office/knowledge.json'), '{"reviewPolicy":"off"}');
  meetingMemoryContext(f.dir, f.m);
  fs.writeFileSync(path.join(f.dir, '.agent-office/knowledge.json'), '{"reviewPolicy":"required"}');
  assert.equal(meetingMemoryGate(f.dir, f.m), undefined);
  assert.equal(meetingMemoryContext(f.dir, { ...f.m, pattern: 'debate' }), '');
  assert.equal(meetingMemoryGate(f.dir, { ...f.m, pattern: 'debate' }), undefined);
});

test('authenticated active meeting participants read shared memory; only their chair writes scoped unverified observations', async t => {
  const f = fixture(t); meetingMemoryContext(f.dir, f.m); f.output();
  let removed = false; let calls = 0; let stale = false; let pumps = 0;
  const floor = { def: { dir: f.dir }, meetings: { state: () => ({ spaces: [{ current: f.m }] }), pump: () => pumps++ },
    workers: { authenticate: (id: string, token: string) => {
      calls++; if (stale && calls > 1) return;
      return token === 'fixture' && !removed ? [f.chair, f.peer].find(w => w.id === id) : undefined;
    } } } as unknown as Floor;
  const server = http.createServer((req, res) => { void floorWorkerKnowledge(floor, req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function call(actor: string, body: unknown, token = 'fixture') {
    calls = 0;
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/office/workers/knowledge?worker=${actor}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  }
  assert.equal((await call('peer', { action: 'index' })).status, 200);
  assert.equal((await call('peer', { action: 'index' }, 'wrong')).status, 401);
  const p = observationPrefix(f.m) + 'cost.md';
  const write = { action: 'write', path: p, frontmatter: { title: 'Costs', summary: 'Sensitivity observation', status: 'active', human_verified_by: 'spoof', verified_at: 'fake' }, body: 'Run-1 shows sensitivity' };
  assert.equal((await call('peer', write)).status, 400);
  assert.equal((await call('chair', { ...write, path: 'project/global.md' })).status, 400);
  assert.equal((await call('chair', { ...write, path: observationPrefix(f.m) + '../escape.md' })).status, 400);
  const saved = await call('chair', write); assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.frontmatter.status, 'needs-verification'); assert.equal(saved.body.frontmatter.human_verified_by, undefined);
  assert.equal(saved.body.frontmatter.verified_at, undefined);
  assert.equal((await call('peer', { action: 'read', path: p })).status, 200);
  assert.equal((await call('chair', { action: 'archive', path: p, reason: 'remove' })).status, 400);
  assert.equal((await call('chair', write)).status, 400); // create-only expectedVersion
  const read = await call('chair', { action: 'read', path: p });
  assert.equal((await call('chair', { ...write, expectedVersion: read.body.version, body: 'Updated evidence' })).status, 200);
  assert.equal((await call('chair', { ...write, expectedVersion: read.body.version })).status, 400);
  assert.equal((await call('peer', { action: 'review_done', changed: [], none_reason: 'No changes' })).status, 400);
  assert.equal((await call('chair', { action: 'review_done', changed: [p] })).status, 200);
  assert.equal(pumps, 1); assert.equal(meetingMemoryGate(f.dir, f.m), undefined);
  stale = true; assert.equal((await call('chair', { action: 'index' })).status, 401); stale = false;
  f.m.status = 'done'; assert.equal((await call('chair', { action: 'index' })).status, 403);
  f.m.status = 'running'; f.chair.meeting = 'different'; assert.equal((await call('chair', { action: 'index' })).status, 403);
  removed = true; assert.equal((await call('peer', { action: 'index' })).status, 401);
});

test('small packets stay bounded and recovery/storage errors hold completion without throwing', t => {
  const f = fixture(t);
  const config = path.join(f.dir, '.agent-office/knowledge.json');
  fs.writeFileSync(config, '{"bootstrapBudgetChars":1000}');
  assert.ok(meetingMemoryContext(f.dir, f.m).length < 1200);
  const restored = { ...f.m, id: 'older-session' };
  assert.match(meetingMemoryGate(f.dir, restored)!, /captured at review/);
  assert.match(meetingMemoryGate(f.dir, restored)!, /Knowledge review required/);
  fs.writeFileSync(config, '{broken');
  assert.match(meetingMemoryGate(f.dir, f.m)!, /unavailable/);
  fs.writeFileSync(config, '{}');
  f.store.stateUpdate(`meeting-memory-${(sessionHash(f.m.id))}.json`, data => { data.packet = {}; });
  assert.match(meetingMemoryGate(f.dir, f.m)!, /Invalid saved/);
});
import { createHash } from 'node:crypto';
function sessionHash(id: string) { return createHash('sha256').update(id).digest('hex'); }

test('restored frozen packets recreate their archive without changing packet identity', t => {
  const f = fixture(t); f.m.notes = 'session-notes';
  const context = meetingMemoryContext(f.dir, f.m);
  const file = path.join(f.dir, f.m.notes, 'knowledge-context.json');
  const original = fs.readFileSync(file, 'utf8');
  fs.rmSync(file);
  assert.equal(meetingMemoryContext(f.dir, f.m), context);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
