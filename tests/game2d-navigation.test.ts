import test from 'node:test';
import assert from 'node:assert/strict';
import { NavGrid, officeNav } from '../src/shared/nav.js';
import { Walker, segmentClear } from '../src/client/game2d/navigation';
const empty = () => new NavGrid({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, { rects: [], circles: [] });
test('keyboard diagonals have cardinal speed, and a stalled frame is clamped', () => {
  const a = new Walker(empty(), [0, 0]), b = new Walker(empty(), [0, 0]);
  a.tick(0.1, 1, 0); b.tick(0.1, 1, 1);
  assert.ok(Math.abs(Math.hypot(...a.at) - Math.hypot(...b.at)) < 1e-8);
  a.tick(20, 1, 0); assert.ok(Math.abs(a.at[0] - 1) < 1e-8);
});
test('keyboard substeps cannot tunnel through furniture and slide along it', () => {
  const nav = new NavGrid({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, { rects: [[0, 0.2, -4, 4]], circles: [] });
  const w = new Walker(nav, [-1, 0]);
  for (let i = 0; i < 100; i++) { const before = [...w.at] as [number, number]; w.tick(0.1, 1, 1); assert.ok(nav.walkable(...w.at)); assert.ok(segmentClear(nav, before, w.at)); }
  assert.ok(w.at[0] < 0); assert.ok(w.at[1] > 1);
});
test('click paths go around furniture and keyboard cancels them', () => {
  const nav = new NavGrid({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, { rects: [[-1, 1, -1, 1]], circles: [] });
  const w = new Walker(nav, [-3, 0]); assert.ok(w.walk([3, 0])); assert.ok(w.path.length > 1);
  for (let i = 0; i < 100; i++) { const before = [...w.at] as [number, number]; w.tick(0.1); assert.ok(segmentClear(nav, before, w.at)); }
  assert.deepEqual(w.at, [3, 0]);
  w.walk([-3, 0]); w.tick(0.1, 0, 1); assert.equal(w.path.length, 0);
});
test('disconnected route fallback never teleports across a wall', () => {
  const nav = new NavGrid({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, { rects: [[-0.2, 0.2, -5, 5]], circles: [] });
  const w = new Walker(nav, [-3, 0]); assert.equal(w.walk([3, 0]), false);
  w.tick(0.1); assert.deepEqual(w.at, [-3, 0]);
});
test('Office spawn recovery and expanded wing use walkable cells', () => {
  for (const wing of [0, 1, 3]) {
    const nav = officeNav(wing), w = new Walker(nav, [-100, -100]);
    assert.ok(nav.walkable(...w.at));
    assert.ok(w.walk([8, 7]));
    for (let i = 0; i < 300; i++) { const before = [...w.at] as [number, number]; w.tick(0.1); assert.ok(nav.walkable(...w.at)); assert.ok(segmentClear(nav, before, w.at)); }
  }
});
