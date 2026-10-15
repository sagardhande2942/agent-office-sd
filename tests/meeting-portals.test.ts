import test from 'node:test';
import assert from 'node:assert/strict';
import { crossedRift, dialReality, realityColor } from '../src/client/features/meeting-portals/logic.js';
import type { MeetingSpace } from '../src/shared/meeting-spaces.js';
const spaces: MeetingSpace[] = ['main', 'other', 'third'].map(id => ({ id, name: id, createdAt: 0, current: null, past: [] }));
test('walking through a rift crosses once from either side; nearby motion and teleports do not', () => {
  assert.equal(crossedRift({ x: 0, y: 0, z: -0.2 }, { x: 0, y: 0, z: 0.2 }), true);
  assert.equal(crossedRift({ x: 0, y: 0, z: 0.2 }, { x: 0, y: 0, z: -0.2 }), true);
  assert.equal(crossedRift({ x: 0, y: 0, z: -0.4 }, { x: 0, y: 0, z: -0.1 }), false);
  assert.equal(crossedRift({ x: 1.5, y: 0, z: -0.2 }, { x: 1.5, y: 0, z: 0.2 }), false);
  assert.equal(crossedRift({ x: 0, y: 3, z: -0.2 }, { x: 0, y: 3, z: 0.2 }), false);
  assert.equal(crossedRift({ x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 3 }), false);
  assert.equal(crossedRift(undefined, { x: 0, y: 0, z: 0 }), false);
  assert.equal(crossedRift({ x: -0.3, y: 0, z: 0.1 }, { x: 0.3, y: 0, z: 0.1 }), false);
});
test('destination dial wraps, survives removed IDs, and does not mutate the catalogue', () => {
  const before = structuredClone(spaces);
  assert.equal(dialReality(spaces, 'main', -1), 'third');
  assert.equal(dialReality(spaces, 'third', 1), 'main');
  assert.equal(dialReality(spaces, 'missing', 1), 'other');
  assert.equal(dialReality([], 'main', 1), undefined);
  assert.equal(dialReality(spaces.slice(0, 1), 'main', 1), 'main');
  assert.deepEqual(spaces, before);
  assert.match(realityColor('main'), /^#[a-f0-9]{6}$/);
  assert.equal(realityColor(before[1].id), realityColor({ ...before[1], name: 'Renamed' }.id));
});
