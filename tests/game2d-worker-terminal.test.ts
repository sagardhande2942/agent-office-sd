import test from 'node:test';
import assert from 'node:assert/strict';
import { visitWorker } from '../src/client/shared/worker-terminal';
import { store } from '../src/client/state';
import type { WorkerInfo } from '../src/shared/protocol.js';
test('terminal policy opens once, resumes only asleep workers, and routes lost worktrees', () => {
  const events: string[] = [];
  const actions = { lost: () => events.push('lost'), resume: () => events.push('resume'), terminal: () => events.push('terminal') };
  const w = { id: 'game2d-test', status: 'working' } as WorkerInfo;
  store.workers.set(w.id, w);
  try {
    visitWorker(w.id, actions); assert.deepEqual(events.splice(0), ['terminal']);
    w.status = 'offline'; visitWorker(w.id, actions); assert.deepEqual(events.splice(0), ['resume', 'terminal']);
    w.lost = { branch: 'here' }; visitWorker(w.id, actions); assert.deepEqual(events.splice(0), ['lost']);
    visitWorker('missing-worker', actions); assert.deepEqual(events, []);
  } finally { store.workers.delete(w.id); }
});
