import test from 'node:test';
import assert from 'node:assert/strict';
import { workerLabels } from '../src/client/shared/activity-heatmap/labels.js';
import type { ActivitySnapshot } from '../src/shared/activity-heatmap.js';

test('readable worker labels retain ID keys, disambiguate names and support legacy history', () => {
  const intervals = [
    { workerId: 'a', workerName: 'Old' }, { workerId: 'a', workerName: 'Ada' },
    { workerId: 'b', workerName: 'Ada' }, { workerId: 'legacy' },
    { workerId: 'blank', workerName: '  ' }, { workerId: 'c', workerName: '<Grace>' },
  ].map(i => ({ ...i, phase: 'unknown' as const, start: 0, end: 10 }));
  assert.deepEqual([...workerLabels({ intervals } as ActivitySnapshot)], [
    ['a', 'Ada (a)'], ['b', 'Ada (b)'], ['legacy', 'legacy'], ['blank', 'blank'], ['c', '<Grace>'],
  ]);
});
