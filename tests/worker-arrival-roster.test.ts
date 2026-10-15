import test from 'node:test';
import assert from 'node:assert/strict';
import { ArrivalRoster } from '../src/client/features/workers/arrival-roster';

test('switching realities never replays arrivals for workers in the live roster', () => {
  const roster = new ArrivalRoster();
  assert.deepEqual([...roster.observe('local', ['a', 'b'])], ['a', 'b']);
  // Reality selection changes the visible avatars, not the live worker roster.
  for (let switchCount = 0; switchCount < 4; switchCount++) {
    assert.deepEqual([...roster.observe('local', ['a', 'b'])], []);
  }
  assert.deepEqual([...roster.observe('local', ['a', 'b', 'new'])], ['new']);
  // Workers hired in a hidden reality are already present when it is visited.
  assert.deepEqual([...roster.observe('local', ['a', 'b', 'new'])], []);
});

test('removed workers and different floors do not leave stale arrival identities', () => {
  const roster = new ArrivalRoster();
  roster.observe('local', ['a']);
  roster.observe('local', []);
  assert.deepEqual([...roster.observe('local', ['a'])], ['a']);
  assert.deepEqual([...roster.observe('remote', ['a'])], ['a']);
  assert.deepEqual([...roster.observe(null, [])], []);
  assert.deepEqual([...roster.observe('local', ['a'])], ['a']);
});
