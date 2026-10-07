import test from 'node:test';
import assert from 'node:assert/strict';
import { HostFloors } from '../src/server/host-floor.js';
import type { Floor } from '../src/server/floor.js';
import type { FromFloor } from '../src/shared/floorhost.js';

test('terminal bursts are ordered and emit no acknowledgements or room snapshots', async () => {
  const sent: FromFloor[] = [], writes: string[] = [], sizes: number[][] = [];
  const host = new HostFloors({ send: (m: FromFloor) => sent.push(m) } as any);
  host.floors.set('remote', { workers: { write: (_id: string, text: string) => writes.push(text), resize: (_id: string, cols: number, rows: number) => sizes.push([cols, rows]) } } as unknown as Floor);
  for (let i = 0; i < 500; i++) await host.call({ t: 'term.input', seq: 0, floorId: 'remote', workerId: 'worker', data: String(i), by: 'Alice' });
  await host.call({ t: 'term.resize', seq: 0, floorId: 'remote', workerId: 'worker', cols: 120, rows: 30 });
  assert.deepEqual(writes, Array.from({ length: 500 }, (_, i) => String(i)));
  assert.deepEqual(sizes, [[120, 30]]);
  assert.deepEqual(sent, [], 'no 501 replies or 5,511 unrelated room snapshots');
  // An old office still receives its expected response, but no room refresh.
  await host.call({ t: 'term.input', seq: 42, floorId: 'remote', workerId: 'worker', data: 'old', by: 'Alice' });
  assert.deepEqual(sent, [{ t: 'result', floorId: 'remote', seq: 42, value: null }]);
  await host.call({ t: 'worker.attach', seq: 43, floorId: 'missing', workerId: 'worker' });
  assert.equal(sent[1].t, 'refused');
});

test('browser input, resize and detach reach hosted workers only after attachment', async () => {
  const { workerHandlers } = await import('../src/server/ws/handlers/workers.js');
  const calls: unknown[][] = [];
  const ctx: any = { workerFloor: () => { throw new Error('local-only lookup must not handle remote terminals'); }, actionWorkerFloor: (id: string) => id === 'remote-worker' ? { workers: {
    write: (...args: unknown[]) => calls.push(['write', ...args]), resize: (...args: unknown[]) => calls.push(['resize', ...args]), detach: (...args: unknown[]) => calls.push(['detach', ...args]),
  } } : undefined };
  const c: any = { id: 'viewer', peer: { name: 'Alice' }, attached: new Set(), typingAt: new Map() };
  const input = { t: 'term.input' as const, workerId: 'remote-worker', data: 'hello' };
  await workerHandlers['term.input'](ctx, c, input);
  await workerHandlers['term.resize'](ctx, c, { t: 'term.resize', workerId: 'remote-worker', cols: 100, rows: 30 });
  assert.deepEqual(calls, []);
  c.attached.add('remote-worker');
  await workerHandlers['term.input'](ctx, c, input);
  await workerHandlers['term.resize'](ctx, c, { t: 'term.resize', workerId: 'remote-worker', cols: 100, rows: 30 });
  await workerHandlers['worker.detach'](ctx, c, { t: 'worker.detach', workerId: 'remote-worker' });
  assert.deepEqual(calls, [['write', 'remote-worker', 'hello', 'Alice'], ['resize', 'remote-worker', 100, 30], ['detach', 'remote-worker', 'viewer']]);
  await workerHandlers['term.input'](ctx, c, input);
  assert.equal(calls.length, 3);
});
