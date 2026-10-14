import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateActivity, type ActivitySnapshot } from '../src/shared/activity-heatmap.js';
const snapshot: ActivitySnapshot = { version: 1, now: 10000, coverage: { since: 0, lastObservedAt: 10000, dropped: 0, historical: true, gaps: [], unavailable: {} }, intervals: [
  { workerId: 'a', activityId: 'one', taskId: 't', attempt: 1, phase: 'implementation', start: 0, end: 2000 },
  { workerId: 'a', activityId: 'one', taskId: 't', attempt: 1, phase: 'waiting', start: 2000, end: 6000 },
  { workerId: 'b', activityId: 'two', taskId: 't', attempt: 2, phase: 'retries', start: 1000, end: 4000 },
  { workerId: 'b', activityId: 'two', taskId: 't', attempt: 2, phase: 'checks', start: 7000 },
] };
test('buckets split phase boundaries and distinguish overlapping worker sum from office union', () => {
  const result = aggregateActivity(snapshot, { start: 0, bucketMs: 3000 });
  assert.equal(result.workerTime, 12000);
  assert.equal(result.wallTime, 9000);
  assert.deepEqual(result.totals, { implementation: 2000, waiting: 4000, checks: 3000, retries: 3000, review: 0, unknown: 0 });
  const first = result.cells.find(c => c.workerId === 'a' && c.start === 0)!;
  assert.equal(first.durations.implementation, 2000);
  assert.equal(first.durations.waiting, 1000);
  assert.equal(result.cells.find(c => c.workerId === 'b' && c.start === 9000)!.live, true);
});
test('filters clip live intervals to observation time and preserve attempt identity', () => {
  const result = aggregateActivity(snapshot, { start: 2500, end: 20000, workerId: 'b', activityId: 'two', bucketMs: 2000 });
  assert.equal(result.workerTime, 4500);
  assert.equal(result.wallTime, 4500);
  assert.equal(result.end, 10000);
  assert.equal(result.cells[0].intervals[0].attempt, 2);
  assert.equal(aggregateActivity(snapshot, { activityId: 'missing' }).workerTime, 0);
});
test('empty history retains an explicit observation window with no fabricated intervals', () => {
  const result = aggregateActivity({ ...snapshot, intervals: [] }, { start: 0 });
  assert.deepEqual(result.cells, []);
  assert.equal(result.wallTime, 0);
  assert.equal(result.workerTime, 0);
});
