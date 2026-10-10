import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorldsView } from '../src/shared/parallel-worlds';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol';
import { runningWorlds } from '../src/client/features/parallel-worlds/visibility';

const experiment = (archived = false): WorldsView => ({
  id: 'experiment', task: 'Build', agent: { provider: 'codex' }, base: 'base', from: 'main',
  createdAt: 1, createdBy: 'Alice', archived,
  worlds: [{ id: 'world', name: 'Minimal', brief: 'Simple', workerId: 'worker' }],
});
const workers = (status: WorkerStatus) => new Map([['worker', { status } as WorkerInfo]]);

test('gates exist only while the current experiment has a busy worker', () => {
  for (const status of ['starting', 'working', 'needs_input'] as const)
    assert.equal(runningWorlds([experiment()], workers(status)), true, status);
  for (const status of ['idle', 'done', 'offline', 'exited'] as const)
    assert.equal(runningWorlds([experiment()], workers(status)), false, status);
  assert.equal(runningWorlds([], workers('working')), false);
  assert.equal(runningWorlds([experiment(true)], workers('working')), false);
  assert.equal(runningWorlds([experiment()], new Map()), false);
});

test('gates follow live status changes and ignore older experiments and lost workers', () => {
  const live = workers('working');
  assert.equal(runningWorlds([experiment()], live), true);
  live.get('worker')!.status = 'done';
  assert.equal(runningWorlds([experiment()], live), false);
  live.get('worker')!.status = 'working';
  assert.equal(runningWorlds([{ ...experiment(), worlds: [] }, experiment()], live), false);
  live.get('worker')!.lost = { branch: 'here' };
  assert.equal(runningWorlds([experiment()], live), false);
});
