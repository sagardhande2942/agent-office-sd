import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock } from '../src/client/core/frame-clock';
import { blendStance, stanceOf, type Act, type Stance } from '../src/client/world/character/worker-stance';

test('board bots start with finite poses on the clock’s zero-delta first frame', () => {
  const clock = new FrameClock();
  const acts = new Map<Act, number>();
  const out = {} as Stance, scratch = {} as Stance;
  for (const now of [0, 17, 34, 51]) {
    const dt = clock.frame(now, 60)!;
    blendStance(acts, 'rest', dt, clock.elapsed, scratch, out);
    assert.ok(Object.values(out).every(Number.isFinite));
  }
  assert.equal(acts.get('rest'), 1);
});

test('zero-time initialization also supports newly hired and waiting workers', () => {
  for (const act of ['rest', 'type', 'waiting', 'up'] as Act[]) {
    const acts = new Map<Act, number>();
    const out = blendStance(acts, act, 0, 2, {} as Stance, {} as Stance);
    assert.deepEqual(out, stanceOf(act, 2, {} as Stance));
    assert.ok(Object.values(out).every(Number.isFinite));
  }
});

test('a zero-delta role change preserves an already established pose blend', () => {
  const acts = new Map<Act, number>([['rest', 1]]);
  const out = blendStance(acts, 'type', 0, 2, {} as Stance, {} as Stance);
  assert.deepEqual(out, stanceOf('rest', 2, {} as Stance));
  const next = blendStance(acts, 'type', 1 / 60, 2, {} as Stance, {} as Stance);
  assert.ok(Object.values(next).every(Number.isFinite));
  assert.ok(acts.get('rest')! > 0 && acts.get('type')! > 0);
});
