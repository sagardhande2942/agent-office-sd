import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TableTennisMatch } from '../src/server/tabletennis.js';
import { TableTennisController } from '../src/client/features/tabletennis/controller.js';
import { TableTennisWatch } from '../src/client/features/tabletennis/watch.js';
import { TableTennisBot } from '../src/client/features/tabletennis/bot.js';
import type { PlayerController } from '../src/client/player/index.js';

test('bot exhibition keeps an operator, two difficulties and non-controlling watchers', () => {
  const match = new TableTennisMatch();
  assert.ok(match.join('host', 'Host', 'west', 'bots', undefined, 'easy', 'pro'));
  assert.equal(match.state().westPlayer?.difficulty, 'pro'); assert.equal(match.state().eastPlayer?.difficulty, 'easy');
  assert.ok(match.join('viewer', 'Viewer', 'west', 'bots'));
  assert.equal(match.state().operatorId, 'host'); assert.deepEqual(match.state().watcherIds, ['host', 'viewer']);
  assert.equal(match.serve('viewer', 'west', 3, 2, 0), null);
  assert.equal(match.hit('viewer', 'east', 7, 1, 15, -3, 2, 0), null);
  assert.equal(match.awardPoint('viewer', 'west'), null);
  assert.ok(match.leave('viewer')); assert.equal(match.state().active, true);
  assert.ok(match.leave('host')); assert.equal(match.state().active, false);
});

test('watch mode cannot replace a match already being played', () => {
  const match = new TableTennisMatch(); match.join('human', 'Human', 'west', 'bot');
  assert.equal(match.join('viewer', 'Viewer', 'west', 'bots'), false);
  assert.equal(match.state().westPlayer?.id, 'human');
});

test('two bots automatically serve, return bounced balls from both sides, score and restart', () => {
  const random = Math.random; Math.random = () => 0.5;
  try {
    const match = new TableTennisMatch(); match.join('host', 'Host', 'west', 'bots', undefined, 'pro', 'pro');
    const sides = new Set<string>(); let points = 0, resets = 0, serves = 0;
    const player = { pos: new THREE.Vector3(), facing: 0, camYaw: 0, lookPitch: 0 } as unknown as PlayerController;
    const c = new TableTennisController(player, () => ({ setBall() {} }) as any, {
      sendServe(side, vx, vy, vz, swing, origin) { serves++; assert.ok(match.serve('host', side, vx, vy, vz, swing, origin)); sides.add(side); },
      sendHit(side, x, y, z, vx, vy, vz, swing) { assert.ok(match.hit('host', side, x, y, z, vx, vy, vz, swing)); sides.add(side); },
      awardPoint(winner, reason) { assert.ok(match.awardPoint('host', winner, reason)); points++; }, playSound() {}, onDone() {},
    });
    c.start('west', 'bots', 'pro');
    const watch = new TableTennisWatch(c, () => { match.reset(); resets++; }); watch.start('pro');
    for (let i = 0; i < 1800; i++) { watch.update(1 / 60, match.state(), 'host'); c.update(1 / 60, match.state()); }
    assert.deepEqual([...sides].sort(), ['east', 'west']);
    const beforePoints = points;
    let seed = 12345;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 18000 && points < beforePoints + 10; i++) { watch.update(1 / 60, match.state(), 'host'); c.update(1 / 60, match.state()); }
    Math.random = () => 0.5;
    assert.ok(points >= beforePoints + 10, 'pro bots must finish ten points naturally within five simulated minutes');
    // Complete a match to exercise the restart without waiting through three full games.
    while (match.state().status !== 'ended') {
      const state = match.state();
      if (!state.lastHitBy) match.serve('host', state.server, state.server === 'west' ? 3 : -3, 2, 0);
      match.awardPoint('host', 'west');
    }
    c.ballInPlay = false;
    const before = serves;
    for (let i = 0; i < 240; i++) { watch.update(1 / 60, match.state(), 'host'); c.update(1 / 60, match.state()); }
    assert.equal(resets, 1); assert.deepEqual(match.state().games, { west: 0, east: 0 });
    assert.ok(serves > before, 'The next match serves automatically after restarting');
  } finally { Math.random = random; }
});

test('a spectator never operates either bot', () => {
  const match = new TableTennisMatch(); match.join('host', 'Host', 'west', 'bots');
  let serves = 0;
  const player = { pos: new THREE.Vector3(), facing: 0, camYaw: 0, lookPitch: 0 } as unknown as PlayerController;
  const c = new TableTennisController(player, () => ({ setBall() {} }) as any, { sendServe() { serves++; }, sendHit() {}, awardPoint() {}, playSound() {}, onDone() {} });
  c.start('west', 'bots'); const watch = new TableTennisWatch(c, () => {});
  for (let i = 0; i < 300; i++) { watch.update(1 / 60, match.state(), 'viewer'); c.update(1 / 60, match.state()); }
  assert.equal(serves, 0); assert.equal(c.automatesOpponent, false);
});


test('a bot commits to one miss decision until the next incoming shot', () => {
  const bot = new TableTennisBot('pro'); bot.reset('east');
  const pos = bot.where;
  const ball = { x: pos.x - 0.46, z: pos.z - 0.26, y: 1.04, vx: 1, vy: 0, vz: 0, tops: 0, side: 0 };
  const plan = { to: pos, stroke: 'topspin' as const, aim: pos, out: 0, depth: 0, power: 0.5 };
  bot.look(1, 0);
  assert.equal(bot.canMeet(ball, plan, 0), false);
  for (let i = 0; i < 100; i++) assert.equal(bot.canMeet(ball, plan, 1), false);
  bot.look(2, 0);
  assert.equal(bot.canMeet(ball, plan, 1), true);
  assert.equal(bot.canMeet(ball, plan, 0), true);
});
