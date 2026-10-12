import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TableTennisMatch } from '../src/server/tabletennis.js';
import { TableTennisController } from '../src/client/features/tabletennis/controller.js';
import type { PlayerController } from '../src/client/player/index.js';
import { defaultPingPongState, flyBall, flyStep, inTableHalf, otherSide, PINGPONG_TABLE, shotTarget, solveShot } from '../src/shared/tabletennis.js';
import { netContact } from '../src/shared/tabletennis-ballistics.js';

test('the floor preserves finite pace, aim and spin instead of substituting a centred default', () => {
  const match = new TableTennisMatch(); match.join('alice', 'Alice', 'west', 'bot');
  const first = match.serve('alice', 'west', 4.9, 2.8, 0.75, { tops: 1.7, side: 0.4, kind: 'topspin' })!.ball;
  assert.deepEqual([first.vx, first.vy, first.vz, first.tops, first.side], [4.9, 2.8, 0.75, 1.7, 0.4]);
  const second = match.hit('bot', 'east', 7.4, 1.2, 15.3, -6.2, 1.9, -1.1, { tops: -1.3, side: -0.8, kind: 'backspin' })!.ball;
  assert.deepEqual([second.vx, second.vy, second.vz, second.kind], [-6.2, 1.9, -1.1, 'backspin']);
  const invalid = match.hit('alice', 'west', 4.6, 1, 15, NaN, Infinity, -Infinity)!.ball;
  assert.ok([invalid.vx, invalid.vy, invalid.vz].every(Number.isFinite));
  assert.ok(match.hit('bot', 'east', 7.4, 1, 15, 4, 2, 0)!.ball.vx < 0);
});

test('charged strokes retain significantly more pace than taps from the same contact', () => {
  for (const side of ['west', 'east'] as const) {
    const from = { x: PINGPONG_TABLE.x + (side === 'west' ? -1.4 : 1.4), y: 1.3, z: 15 };
    const target = shotTarget(side, 0.4, 0.5);
    const tap = solveShot(from, target, 'drive', 0.25), full = solveShot(from, target, 'drive', 1);
    assert.ok(Math.abs(full.vx) > Math.abs(tap.vx) * 1.5);
    assert.ok(full.t < tap.t);
  }
});

test('every stroke, charge and direction clears the net and reaches its selected half', () => {
  for (const side of ['west', 'east'] as const) for (const kind of ['drive', 'topspin', 'backspin', 'smash'] as const)
    for (const power of [0.25, 0.6, 1]) for (const aim of [-1, 0, 1]) for (const depth of [-1, 0, 1]) {
      const from = { x: PINGPONG_TABLE.x + (side === 'west' ? -1.4 : 1.4), y: 0.95, z: 15 };
      const target = shotTarget(side, aim, depth), shot = solveShot(from, target, kind, power, aim * 0.45);
      const result = flyBall(from, shot, 2, { tops: shot.tops, side: shot.side });
      assert.equal(result.where, 'bounce', `${side}/${kind}/${power}/${aim}/${depth}`);
      assert.ok(inTableHalf(otherSide(side), result.at.x, result.at.z));
      assert.ok(Math.hypot(result.at.x - target.x, result.at.z - target.z) < 0.06);
    }
});

test('decaying spin produces the same flight across frame sizes', () => {
  const a = { x: 4.6, y: 1.1, z: 15, vx: 4.5, vy: 3, vz: 0.3, tops: 1.7, side: 0.8 }, b = { ...a };
  flyStep(a, 0.4); for (let i = 0; i < 40; i++) flyStep(b, 0.01);
  for (const key of Object.keys(a) as (keyof typeof a)[]) assert.ok(Math.abs(a[key] - b[key]) < 1e-10, key);
});

function controller() {
  const player = { pos: new THREE.Vector3(), facing: 0, camYaw: 0, lookPitch: 0 } as unknown as PlayerController;
  const hits: number[][] = [];
  const c = new TableTennisController(player, () => ({ setBall() {} }) as any, { sendServe() {}, sendHit(_s, ...values) { hits.push(values.slice(0, 6) as number[]); }, awardPoint() {}, playSound() {}, onDone() {} });
  c.start('west', 'pvp'); return { c, hits };
}

test('returns start at the actual ball contact; swinging cannot hit your own outgoing ball', () => {
  const { c, hits } = controller();
  c.ballInPlay = true; c.ballPos.set(4.5, 1.05, 15.2); c.lastHitter = 'east'; c.lastBounceSide = 'west';
  c.swing('drive', 0.8); assert.equal(hits.length, 1); assert.deepEqual(hits[0].slice(0, 3), [4.5, 1.05, 15.2]);
  c.swinging = false; c.swing('drive'); assert.equal(hits.length, 1);
});

test('net sweeps catch fast shots and live collisions change the flight velocity', () => {
  assert.equal(netContact({ x: 5.7, y: 0.88, z: 15 }, { x: 6.3, y: 0.85, z: 15 }), true);
  assert.equal(netContact({ x: 5.7, y: 1.3, z: 15 }, { x: 6.3, y: 1.2, z: 15 }), false);
  const { c } = controller(); c.ballInPlay = true; c.ballPos.set(5.94, 0.87, 15); c.ballVel.set(8, 0, 0);
  c.update(0.02, defaultPingPongState()); assert.ok(c.ballVel.x < 0); assert.ok(c.ballPos.x < 6);
});


test('serve acknowledgement preserves an off-centre contact instead of moving it to the middle', () => {
  const match = new TableTennisMatch(); match.join('alice', 'Alice', 'west', 'bot');
  const ball = match.serve('alice', 'west', 4, 2, -0.6, { tops: 1.7, side: 0.4, kind: 'topspin' }, { x: 4.8, y: 0.98, z: 15.6 })!.ball;
  assert.deepEqual([ball.x, ball.y, ball.z], [4.8, 0.98, 15.6]);
});


test('a fresh match clears swing recovery from the previous game', () => {
  const { c } = controller(); c.swinging = c.oppSwinging = true; c.swingProgress = c.oppSwingProgress = 2;
  c.stop(); c.start('west', 'pvp'); assert.equal(c.swinging, false); assert.equal(c.oppSwinging, false); assert.equal(c.swingProgress, 0);
});


test('inactive or awaiting-join controllers cannot launch ghost bot serves', () => {
  let serves = 0;
  const player = { pos: new THREE.Vector3(), facing: 0, camYaw: 0, lookPitch: 0 } as unknown as PlayerController;
  const c = new TableTennisController(player, () => ({ setBall() {} }) as any, { sendServe() { serves++; }, sendHit() {}, awardPoint() {}, playSound() {}, onDone() {} });
  c.start('west', 'bot'); c.stop();
  c.update(2, { ...defaultPingPongState(), active: true, mode: 'bot', server: 'east', status: 'point' });
  assert.equal(serves, 0); assert.equal(c.ballInPlay, false);
  c.start('west', 'bot'); c.update(2, { ...defaultPingPongState(), server: 'east' }); assert.equal(serves, 0);
});

for (const side of ['west', 'east'] as const) for (const dt of [1 / 60, 1 / 20, 0.12]) {
  test(`bot returns short/deep bounced shots from ${side} at dt=${dt}`, () => {
    const random = Math.random; Math.random = () => 0.5;
    try {
      for (const kind of ['drive', 'topspin', 'backspin', 'smash'] as const) for (const power of [0.25, 1]) for (const depth of [-1, 0, 1]) for (const aim of [-0.6, 0, 0.6]) {
        const { c, hits } = controller(); c.start(side, 'bot', 'normal');
        const from = { x: 6 + (side === 'west' ? -1.2 : 1.2), y: 0.98, z: 15 };
        const shot = solveShot(from, shotTarget(side, aim, depth), kind, power);
        c.ballPos.set(from.x, from.y, from.z); c.ballVel.set(shot.vx, shot.vy, shot.vz);
        c.ballTops = shot.tops; c.ballSide = shot.side; c.ballInPlay = true; c.lastHitter = side; c.rally = 1;
        for (let time = 0; time < 2 && hits.length === 0 && c.ballInPlay; time += dt) c.update(dt, { ...defaultPingPongState(), active: true, status: 'rally' });
        assert.equal(hits.length, 1, `${kind}/${power}/${depth}/${aim}`);
        assert.equal(Math.sign(hits[0][3]), side === 'west' ? -1 : 1);
      }
    } finally { Math.random = random; }
  });
}

test('serves bounce on both halves in order for every stroke, charge and aim', async () => {
  const { solveServe, tableBounce, PINGPONG_PHYSICS } = await import('../src/shared/tabletennis.js');
  for (const side of ['west', 'east'] as const) for (const kind of ['drive', 'topspin', 'backspin', 'smash'] as const)
    for (const power of [0, 0.5, 1]) for (const aim of [-1, 0, 1]) for (const depth of [-1, 0, 1]) {
      const from = { x: 6 + (side === 'west' ? -1.2 : 1.2), y: 0.98, z: 15 + aim * 0.55 };
      const target = shotTarget(side, aim, depth), shot = solveServe(from, target, kind, power);
      assert.ok(shot, `${side}/${kind}/${power}/${aim}/${depth}`);
      const first = flyBall(from, shot, 1, shot);
      assert.equal(first.where, 'bounce'); assert.ok(inTableHalf(side, first.at.x, first.at.z));
      const ball = { ...from, ...shot }; flyStep(ball, shot.t);
      ball.y = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius; tableBounce(ball);
      const second = flyBall(ball, ball, 2, ball);
      assert.equal(second.where, 'bounce', `${side}/${kind}/${power}/${aim}/${depth}`);
      assert.ok(inTableHalf(otherSide(side), second.at.x, second.at.z));
      assert.ok(Math.abs(second.at.x - target.x) < 0.08);
    }
});

test('service stays with each player for two points and alternates every point at deuce', async () => {
  const { afterPoint } = await import('../src/shared/tabletennis.js');
  let state = defaultPingPongState();
  const expected = ['west', 'east', 'east', 'west', 'west', 'east', 'east', 'west'];
  for (const server of expected) { const next = afterPoint(state, 'west'); assert.equal(next.server, server); state = { ...state, ...next }; }
  state = { ...defaultPingPongState(), score: { west: 10, east: 10 }, server: 'east' };
  let next = afterPoint(state, 'west'); assert.equal(next.server, 'west');
  next = afterPoint({ ...state, ...next }, 'east'); assert.equal(next.server, 'east');
});

test('a return landing on the striker’s half immediately loses the point', () => {
  const points: string[] = [];
  const player = { pos: new THREE.Vector3(), facing: 0, camYaw: 0, lookPitch: 0 } as unknown as PlayerController;
  const c = new TableTennisController(player, () => ({ setBall() {} }) as any, {
    sendServe() {}, sendHit() {}, awardPoint(winner) { points.push(winner); }, playSound() {}, onDone() {},
  });
  c.start('west', 'pvp');
  c.adopt({ x: 5.2, y: 0.8, z: 15, vx: 1, vy: -1, vz: 0, tops: 0, side: 0, kind: 'drive', t: 1 }, 2);
  c.update(0.05, { ...defaultPingPongState(), active: true, status: 'rally', rally: 2 });
  assert.deepEqual(points, ['east']); assert.equal(c.ballInPlay, false);
});

test('charging a serve increases pace while preserving the same landing target', async () => {
  const { solveServe } = await import('../src/shared/tabletennis.js');
  for (const side of ['west', 'east'] as const) {
    const from = { x: 6 + (side === 'west' ? -1.2 : 1.2), y: 0.98, z: 15 };
    const target = shotTarget(side);
    const tap = solveServe(from, target, 'topspin', 0.25), full = solveServe(from, target, 'topspin', 1);
    assert.ok(Math.abs(full.vx) > Math.abs(tap.vx) * 1.05);
  }
});
