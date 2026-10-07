import test from 'node:test';
import assert from 'node:assert/strict';
import { chronological, filterEvents, safePrUrl } from '../src/client/ui/task-replay/index.js';
import type { ReplayEvent } from '../src/shared/task-replay.js';
const event = (id: string, timestamp: number, participantId: string, taskId: string, type: ReplayEvent['type']): ReplayEvent => ({id,timestamp,activityId:'run',participantId,taskId,type,summary:id,details:{}});
test('replay filters combine participant, task and event type without mutating recorded order', () => {
  const events=[event('late',3,'worker','api','result'),event('early',1,'master','api','assignment'),event('other',2,'worker','ui','result')];
  assert.deepEqual(chronological(events).map(e=>e.id),['early','other','late']);
  assert.deepEqual(filterEvents(events,'worker','api','result').map(e=>e.id),['late']);
  assert.deepEqual(filterEvents(events,'master','','result'),[]);
  assert.deepEqual(events.map(e=>e.id),['late','early','other']);
});
test('replay PR links reject executable and credential-bearing URLs', () => {
  assert.equal(safePrUrl('javascript:alert(1)'),undefined);
  assert.equal(safePrUrl('file:///tmp/private'),undefined);
  assert.equal(safePrUrl('https://user:secret@example.test/pr/1'),undefined);
  assert.equal(safePrUrl('https://github.com/org/repo/pull/1'),'https://github.com/org/repo/pull/1');
});
