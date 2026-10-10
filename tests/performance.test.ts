import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock } from '../src/client/core/frame-clock';
import { Ticks } from '../src/client/core/registry';
import { effectiveFps, parseFps } from '../src/client/features/performance/preferences';

test('FPS caps pace callbacks across display rates and preserve simulation time', () => {
  for (const display of [60, 90, 120, 144]) for (const cap of [30, 60, 90, 120, 0]) {
    const clock = new FrameClock();
    let count = 0;
    for (let i = 0; i <= display * 10; i++) {
      if (clock.frame(i * 1000 / display, cap) !== null) count++;
    }
    assert.ok(Math.abs(count - Math.min(cap || display, display) * 10) <= 2, `${cap} on ${display}: ${count}`);
    assert.ok(Math.abs(clock.elapsed - 10) < 0.04);
  }
});

test('pause resumes without a movement jump; changed caps take effect immediately', () => {
  const clock = new FrameClock();
  assert.equal(clock.frame(0, 30), 0);
  assert.equal(clock.frame(16, 30), null);
  assert.equal(clock.frame(16, 120), 0.016);
  assert.equal(clock.frame(20, null), null);
  assert.equal(clock.frame(100000, 60), 0);
  assert.ok(clock.frame(100017, 60)! < 0.02);
  assert.ok(clock.elapsed < 0.04);
});

test('policies compose, unregister and distinguish display matching from suspension', () => {
  const ticks = new Ticks();
  assert.equal(ticks.frameRate(), 0);
  ticks.limit(() => 120);
  const off = ticks.limit(() => 30);
  assert.equal(ticks.frameRate(), 30);
  off();
  assert.equal(ticks.frameRate(), 120);
  const resume = ticks.limit(() => null);
  assert.equal(ticks.frameRate(), null);
  resume();
  assert.equal(ticks.frameRate(), 120);
});

test('preferences validate persisted values and lower background/window work', () => {
  for (const value of [30, 60, 90, 120, 'display']) assert.equal(parseFps(value), value);
  for (const value of [null, '120', 0, -1, {}, 240]) assert.equal(parseFps(value), 60);
  assert.equal(effectiveFps('display', false, false), 0);
  assert.equal(effectiveFps(30, false, false), 30);
  assert.equal(effectiveFps(120, false, true), 15);
  assert.equal(effectiveFps(120, true, false), null);
});
