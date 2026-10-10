import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorldsController, type WorldsIO } from '../src/server/parallel-worlds/controller.js';
import { WorldsStorage, worldsRequest } from '../src/server/parallel-worlds/storage.js';
import { WORLD_APPROACHES } from '../src/shared/parallel-worlds.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const request = () => worldsRequest({ task: 'Build a dashboard', agent: { provider: 'codex' }, approaches: WORLD_APPROACHES });
const base = { commit: 'a'.repeat(40), from: 'main' };
function fixture(t: { after(fn: () => void): void }, overrides: Partial<WorldsIO> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'worlds-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'worlds.json');
  const workers = new Map<string, WorkerInfo>();
  const prompts: string[] = [];
  const bases: typeof base[] = [];
  const io: WorldsIO = {
    room: () => 3, base: () => base,
    spawn: (_r, prompt, pinned) => {
      const id = `worker-${workers.size}`;
      const worker = { id, name: id, status: 'done', worktree: { path: id, branch: `office/${id}`, base: pinned.commit } } as WorkerInfo;
      workers.set(id, worker); prompts.push(prompt); bases.push(pinned); return worker;
    },
    worker: id => workers.get(id), feedback: () => undefined, changed: () => {}, ...overrides,
  };
  const controller = new WorldsController(new WorldsStorage(file), io);
  return { file, workers, prompts, bases, controller };
}
test('three variants share a pinned base, receive independent briefs and survive restart', t => {
  const f = fixture(t);
  const e = f.controller.start(request(), 'Alice', 'alice');
  assert.equal(new Set(e.worlds.map(w => w.workerId)).size, 3);
  assert.equal(new Set(e.worlds.map(w => w.branch)).size, 3);
  assert.deepEqual(f.bases, [base, base, base]);
  f.prompts.forEach((p, i) => { assert.match(p, /Build a dashboard/); assert.ok(p.includes(WORLD_APPROACHES[i].brief)); assert.match(p, /Do not open or merge a PR/); });
  assert.deepEqual(new WorldsStorage(f.file).state.experiments[0], JSON.parse(readFileSync(f.file, 'utf8')).experiments[0]);
  assert.throws(() => f.controller.start(request(), 'Alice'), /Archive/);
});
test('capacity rejection launches nothing', t => {
  let launches = 0;
  const f = fixture(t, { room: () => 2, spawn: () => { launches++; return 'unexpected'; } });
  assert.throws(() => f.controller.start(request(), 'Alice'), /Three free desks/);
  assert.equal(launches, 0); assert.equal(f.controller.storage.state.experiments.length, 0);
});
test('partial failures remain visible without losing successful worlds', t => {
  let launches = 0;
  const f = fixture(t, { spawn: () => ++launches === 2 ? 'Provider unavailable' : ({ id: `w${launches}`, worktree: { branch: `b${launches}` } } as WorkerInfo) });
  const e = f.controller.start(request(), 'Alice');
  assert.equal(e.worlds[0].workerId, 'w1'); assert.equal(e.worlds[1].error, 'Provider unavailable'); assert.equal(e.worlds[2].workerId, 'w3');
  assert.equal(new WorldsStorage(f.file).state.experiments[0].worlds[1].error, 'Provider unavailable');
});
test('ownership, ready-state and missing-worktree guards prevent invalid selection', t => {
  const f = fixture(t); const e = f.controller.start(request(), 'Alice', 'alice');
  assert.throws(() => f.controller.experiment(e.id, 'bob'), /creator/);
  assert.equal(f.controller.experiment(e.id, 'bob', true), e);
  const w = f.workers.get(e.worlds[0].workerId!)!;
  w.status = 'working'; assert.throws(() => f.controller.control(e, 'select', e.worlds[0].id, undefined, 'Alice'), /finishes/);
  w.status = 'done'; w.lost = {} as WorkerInfo['lost'];
  assert.throws(() => f.controller.control(e, 'select', e.worlds[0].id, undefined, 'Alice'), /unavailable/);
  w.lost = undefined; f.workers.delete(w.id);
  assert.throws(() => f.controller.control(e, 'select', e.worlds[0].id, undefined, 'Alice'), /unavailable/);
});
test('feedback invalidates the winner; archive preserves all workers and branches', t => {
  const f = fixture(t); const e = f.controller.start(request(), 'Alice'); const w = e.worlds[0];
  f.controller.control(e, 'select', w.id, undefined, 'Alice'); assert.equal(e.winner, w.id);
  f.controller.control(e, 'feedback', w.id, 'Improve keyboard navigation', 'Alice'); assert.equal(e.winner, undefined);
  f.controller.control(e, 'archive', undefined, undefined, 'Alice');
  assert.equal(f.workers.size, 3); assert.equal(e.archived, true);
  assert.throws(() => f.controller.control(e, 'feedback', w.id, 'Edit', 'Alice'), /archived/);
  assert.equal(f.controller.start(request(), 'Alice').worlds.length, 3);
});
test('malformed requests and corrupted history fail closed', t => {
  assert.throws(() => worldsRequest({ ...request(), approaches: [] }), /three/);
  assert.throws(() => worldsRequest({ ...request(), agent: { provider: 'made-up' } }), /provider/);
  assert.throws(() => worldsRequest({ ...request(), task: ' ' }), /task/);
  assert.throws(() => worldsRequest({ ...request(), approaches: [WORLD_APPROACHES[0], WORLD_APPROACHES[0], WORLD_APPROACHES[2]] }), /distinct/);
  const f = fixture(t); writeFileSync(f.file, '{');
  const bad = new WorldsStorage(f.file); assert.match(bad.state.error!, /Cannot read/);
  assert.throws(() => bad.save(), /Cannot read/); assert.equal(readFileSync(f.file, 'utf8'), '{');
});
