import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Floor } from '../src/server/floor.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { isToOffice } from '../src/shared/floorhost.js';
import { Communications } from '../src/server/communications.js';
import { executeHandoff, handoffs, prefill } from '../src/server/handoff/service.js';
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  const source = { id: 'source', name: 'Ada', kind: 'agent', deskId: 'desk-1', completionRevision: 3, prompt: 'Finish durable packets', status: 'working', worktree: { path: '.agent-office/worktrees/ada', branch: 'office/ada' }, completion: { revision: 3, summary: 'Added store', files: ['store.ts'], checks: [{ name: 'unit', status: 'passed', evidence: 'node --test: 4 passed' }], commit: 'abcdef1' } } as WorkerInfo;
  const recipient = { id: 'recipient', name: 'Grace', kind: 'agent', deskId: 'desk-2', status: 'working', prompt: 'Unrelated ongoing task', completionRevision: 9 } as WorkerInfo;
  let workers = [source, recipient];
  const floor = { id: 'floor-a', dir, project: { branch: 'main' }, workers: { list: () => workers, prompt: () => { throw Error('No terminal prompting'); }, resume: () => { throw Error('No waking'); } } } as unknown as Floor;
  const ledger = new Communications(path.join(dir, 'inbox'));
  const body = { action: 'create', key: 'packet-1', recipient: 'Grace', revision: 3, nextSteps: 'Add station UI', questions: [], questionsNote: 'None; contract agreed' };
  const run = (worker: WorkerInfo, data: object) => executeHandoff(floor, worker, data as any, ledger) as any;
  return { dir, source, recipient, floor, ledger, body, run, depart: () => { workers = [recipient]; } };
}
test('two-worker create/read/accept preserves unrelated active work and distinguishes receipts', () => {
  const f = fixture(); try {
    const before = structuredClone([f.source, f.recipient]);
    assert.equal(prefill(f.floor, f.source).taskId, 'source:3');
    const p = f.run(f.source, f.body).handoff;
    assert.equal(p.state, 'offered'); assert.equal(p.evidence, 'worker-reported'); assert.deepEqual(p.files, ['store.ts']); assert.equal(p.context.commit, 'abcdef1');
    assert.equal(f.ledger.inbox(f.recipient).messages[0].status, 'delivered');
    f.ledger.acknowledge(f.recipient, p.messageId);
    const read = f.run(f.recipient, { action: 'read', id: p.id }).handoff;
    assert.equal(read.state, 'offered'); assert.equal(read.receipt.status, 'acknowledged');
    assert.throws(() => f.run(f.source, { action: 'accept', id: p.id }), /named recipient/);
    const accepted = f.run(f.recipient, { action: 'accept', id: p.id }).handoff;
    assert.equal(accepted.state, 'accepted'); assert.equal(accepted.continuationOwner.id, f.recipient.id);
    assert.deepEqual(f.run(f.recipient, { action: 'accept', id: p.id }).handoff, accepted);
    assert.deepEqual([f.source, f.recipient], before, 'No active task, completion, terminal status or checkout mutation');
    assert.throws(() => f.run(f.source, { action: 'cancel', id: p.id }), /cannot be cancelled/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('duplicate submission retries after revision change; altered key payload and stale tasks rejected', () => {
  const f = fixture(); try {
    const p = f.run(f.source, f.body).handoff;
    assert.equal(f.run(f.source, f.body).handoff.id, p.id); assert.equal(f.ledger.state().messages.length, 1);
    f.source.completionRevision = 4;
    assert.equal(f.run(f.source, f.body).handoff.id, p.id);
    assert.throws(() => f.run(f.source, { ...f.body, nextSteps: 'different' }), /different handoff/);
    assert.throws(() => f.run(f.source, { ...f.body, key: 'stale' }), /Stale task revision/);
    assert.throws(() => f.run(f.source, { ...f.body, key: 'id', revision: 4, taskId: 'forged' }), /task ID/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('restart and source departure preserve packet and allow recipient acceptance; cross-floor IDs rejected', () => {
  const f = fixture(); try {
    const p = f.run(f.source, f.body).handoff; f.depart();
    const restarted = new Communications(path.join(f.dir, 'inbox'));
    const store = handoffs(f.floor, restarted);
    assert.equal(store.read(p.id).source.name, 'Ada'); assert.equal(store.accept(p.id, f.recipient).state, 'accepted');
    assert.equal(handoffs(f.floor, restarted).read(p.id).state, 'accepted');
    const other = { ...f.floor, id: 'floor-b', dir: path.join(f.dir, 'other') } as Floor;
    assert.throws(() => handoffs(other, restarted).accept(p.id, f.recipient), /Unknown handoff/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('validation, cancellation and storage errors are surfaced', () => {
  const f = fixture(); try {
    for (const change of [{ recipient: 'off-floor' }, { goal: 'x'.repeat(8001) }, { files: [], filesNote: undefined }, { questions: [], questionsNote: undefined }, { checks: [] }, { source: { id: 'spoof' } }, { context: { commit: 'invalid' } }]) assert.throws(() => f.run(f.source, { ...f.body, ...change }));
    const p = f.run(f.source, f.body).handoff;
    assert.throws(() => f.run(f.recipient, { action: 'cancel', id: p.id }), /Only the source/);
    const cancelled = f.run(f.source, { action: 'cancel', id: p.id }).handoff;
    assert.deepEqual(f.run(f.source, { action: 'cancel', id: p.id }).handoff, cancelled);
    assert.throws(() => f.run(f.recipient, { action: 'accept', id: p.id }), /cancelled/);
    mkdirSync(path.join(f.dir, '.agent-office/handoffs.json.tmp'));
    assert.throws(() => f.run(f.source, { ...f.body, key: 'storage' }), /EISDIR/);
    assert.equal(handoffs(f.floor, f.ledger).list().length, 1);
    writeFileSync(path.join(f.dir, '.agent-office/handoffs.json'), '{broken');
    assert.throws(() => handoffs(f.floor, f.ledger));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('persisted outbox retries delivery once after inbox failure', () => {
  const f = fixture(); try {
    const request = f.ledger.request.bind(f.ledger);
    f.ledger.request = () => { throw Error('inbox storage unavailable'); };
    assert.throws(() => f.run(f.source, f.body), /inbox storage unavailable/);
    const pending = handoffs(f.floor, f.ledger).list()[0]; assert.ok(pending); assert.equal(pending.messageId, undefined);
    f.ledger.request = request;
    const delivered = f.run(f.source, f.body).handoff;
    assert.equal(delivered.id, pending.id); assert.ok(delivered.messageId);
    assert.equal(f.run(f.source, f.body).handoff.messageId, delivered.messageId);
    assert.equal(f.ledger.state().messages.length, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('hosted handoff observer reads use the registered floor-scoped RPC', () => {
  assert.equal(isToOffice({ t: 'handoff.list', floorId: 'floor-a', seq: 1 }), true);
  assert.equal(isToOffice({ t: 'handoff.list', seq: 1 }), false);
});
