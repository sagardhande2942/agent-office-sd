import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveWorkers, restoreWorkers } from '../src/server/workers/persist.js';
import assert from 'node:assert/strict';
import { canRest } from '../src/shared/status.js';
import { takeBreak, breakOver } from '../src/server/workers/breaks.js';
import { workerHandlers } from '../src/server/ws/handlers/workers.js';
import { WorkerManager } from '../src/server/workers/manager.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

const worker = (patch: Partial<WorkerInfo> = {}): WorkerInfo => ({
  id: 'break-worker', kind: 'agent', deskId: 'desk-1', name: 'Byte', color: '#ff8a5b',
  status: 'done', acked: true, createdBy: 'alice', createdAt: 1,
  cols: 80, rows: 24, viewers: [], viewerIds: [], ...patch,
});

test('only idle or done agents at their own desk can take breaks', () => {
  for (const status of ['idle', 'done'] as WorkerStatus[]) assert.equal(canRest(worker({ status })), true);
  for (const status of ['starting', 'working', 'needs_input', 'exited', 'offline'] as WorkerStatus[]) {
    const w = worker({ status, resting: 123 });
    assert.equal(canRest(w), false, status);
    assert.ok(takeBreak(w, true));
    assert.equal(w.resting, 123, 'refusal cannot mutate the worker');
  }
  const excluded = [
    { kind: 'shell' }, { deskId: 'station-1' }, { meeting: 'meeting-1' },
    { lost: { branch: 'here' } }, { helper: { hostId: 'other', hostName: 'Other' } },
  ] as Partial<WorkerInfo>[];
  for (const patch of excluded) assert.equal(canRest(worker(patch)), false);
  assert.equal(canRest(worker(), true), false, 'station flag also excludes kiosks');
});

test('starting a break is idempotent and recall clears it even after eligibility changes', () => {
  const w = worker();
  assert.equal(takeBreak(w, true), undefined);
  const started = w.resting;
  assert.ok(started && started <= Date.now());
  assert.equal(takeBreak(w, true), undefined);
  assert.equal(w.resting, started);
  w.status = 'working';
  assert.equal(takeBreak(w, false), undefined);
  assert.equal(w.resting, undefined);
});

test('work, input requests and disconnects end a break before the next update', () => {
  for (const status of ['idle', 'done', 'working', 'needs_input', 'offline', 'exited'] as WorkerStatus[]) {
    const w = worker({ status, resting: 123 });
    const live = { ...w };
    breakOver(w, live);
    const expected = status === 'idle' || status === 'done' ? 123 : undefined;
    assert.equal(w.resting, expected);
    assert.equal(live.resting, expected);
  }
});

test('manager persists and broadcasts breaks without touching the terminal', () => {
  const w = { info: worker() };
  let saves = 0;
  const updates: WorkerInfo[] = [];
  const manager = { workers: new Map([[w.info.id, w]]), persist: () => saves++,
    emitUpdate: (value: typeof w) => updates.push({ ...value.info }) };
  const rest = WorkerManager.prototype.rest;
  assert.equal(rest.call(manager as unknown as WorkerManager, w.info.id, true), undefined);
  assert.equal(saves, 1);
  assert.ok(updates[0].resting);
  assert.equal(rest.call(manager as unknown as WorkerManager, w.info.id, false), undefined);
  assert.equal(saves, 2);
  assert.equal(updates[1].resting, undefined);
  w.info.status = 'working';
  assert.ok(rest.call(manager as unknown as WorkerManager, w.info.id, true));
  assert.ok(rest.call(manager as unknown as WorkerManager, 'missing', true));
  assert.equal(saves, 2);
  assert.equal(updates.length, 2);
});


test('break commands stay on the current floor and surface host refusals', async () => {
  const calls: unknown[][] = [], warnings: string[] = [], toasts: string[] = [];
  let refusal: string | undefined, current = 'other';
  const floor = { id: 'f1', workers: { get: () => worker(), rest: async (...args: unknown[]) => { calls.push(args); return refusal; } } };
  const ctx = { actionWorkerFloor: () => floor, floorOf: () => ({ id: current }),
    warn: (_c: unknown, message: string) => warnings.push(message),
    toastFloor: (_f: unknown, message: string) => toasts.push(message) };
  const client = { peer: { name: 'Alice' } };
  const msg = { t: 'worker.rest' as const, workerId: 'break-worker', on: true };
  await workerHandlers['worker.rest'](ctx as never, client as never, msg);
  assert.equal(calls.length, 0);
  assert.match(warnings[0], /current floor/);
  current = 'f1';
  await workerHandlers['worker.rest'](ctx as never, client as never, msg);
  assert.deepEqual(calls[0], ['break-worker', true]);
  assert.equal(toasts.length, 1);
  refusal = 'Host needs updating';
  await workerHandlers['worker.rest'](ctx as never, client as never, msg);
  assert.equal(warnings[1], refusal);
  assert.equal(toasts.length, 1, 'refusal cannot claim success');
});


test('manager broadcasts a working status without a stale break marker', () => {
  const w = { info: worker({ status: 'working', resting: 123 }) };
  const updates: WorkerInfo[] = [];
  const manager = { events: { update: (info: WorkerInfo) => updates.push(info) } };
  const emit = (WorkerManager.prototype as unknown as { emitUpdate(w: typeof w): void }).emitUpdate;
  emit.call(manager, w);
  assert.equal(w.info.resting, undefined);
  assert.equal(updates[0].resting, undefined);
  assert.equal(updates[0].status, 'working');
});

test('break state is saved, but restart restores workers at their desks offline', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-break-'));
  const file = path.join(dir, 'workers.json');
  try {
    saveWorkers(file, [{ info: worker({ resting: 123 }), state: {} } as never], false);
    assert.equal(JSON.parse(readFileSync(file, 'utf8'))[0].resting, 123);
    const workers = new Map();
    restoreWorkers(file, workers, 'claude', () => false);
    assert.equal(workers.get('break-worker').info.resting, undefined);
    assert.equal(workers.get('break-worker').info.status, 'offline');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
