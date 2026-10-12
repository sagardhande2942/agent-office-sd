import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY, FLOOR } from '../src/shared/layout.js';
import {
  PINGPONG_TABLE,
  PINGPONG_NET,
  PINGPONG_HALVES,
  PINGPONG_SPOTS,
  PINGPONG_PHYSICS,
  flyBall,
  inTableHalf,
  onTableSurface,
  otherSide,
  shotTarget,
  solveShot,
  defaultPingPongState,
  afterPoint,
  onCourt,
  onCourtSpot,
  PINGPONG_COURT,
  PINGPONG_MATCH,
  PINGPONG_SPIN,
  PINGPONG_STROKES,
  tableBounce,
  meetPoint,
  flyStep,
  type PingPongShotKind,
  type PingPongSide,
} from '../src/shared/tabletennis.js';
import { TableTennisMatch } from '../src/server/tabletennis.js';
import { TableTennisBot } from '../src/client/features/tabletennis/bot.js';

test('balcony is extended horizontally across the south facade', () => {
  assert.ok(BALCONY.maxX >= 10.5, `balcony extends to at least x=10.5 (was ${BALCONY.maxX})`);
  const width = BALCONY.maxX - BALCONY.minX;
  assert.ok(width >= 21.0, `balcony is at least 21m wide (was ${width}m)`);
  assert.ok(BALCONY.maxZ > FLOOR.maxZ, 'balcony is outside the south wall');
});

test('table tennis court fits on the extended balcony with player room and walkways', () => {
  const table = PINGPONG_TABLE;
  // Table center is at x=6, z=15 on the balcony
  assert.ok(table.x - table.length / 2 > BALCONY.minX + 5, 'table is clear of the bistro table on the west');
  assert.ok(table.x + table.length / 2 < BALCONY.maxX - 2, 'table is clear of the east railing');
  assert.ok(table.z - table.width / 2 > BALCONY.minZ + 0.8, 'north walkway along south wall is clear');
  assert.ok(table.z + table.width / 2 < BALCONY.maxZ - 0.8, 'south walkway along balcony glass rail is clear');

  // Player spots have clearance and face the table
  assert.ok(PINGPONG_SPOTS.west.x > BALCONY.minX + 2, 'west player spot is on balcony deck');
  assert.ok(PINGPONG_SPOTS.east.x < BALCONY.maxX - 1, 'east player spot is on balcony deck');
  // A body's forward is (sin rotY, cos rotY), so the west player, west of the table, faces east.
  assert.equal(PINGPONG_SPOTS.west.rotY, Math.PI / 2, 'west player faces east toward the table');
  assert.equal(PINGPONG_SPOTS.east.rotY, -Math.PI / 2, 'east player faces west toward the table');
  assert.ok(Math.sin(PINGPONG_SPOTS.west.rotY) > 0.9, 'the west spot looks along +x, at the table');
  assert.ok(Math.sin(PINGPONG_SPOTS.east.rotY) < -0.9, 'the east spot looks along -x, at the table');
});

test('inTableHalf and onTableSurface correctly partition the table halves', () => {
  const { west, east } = PINGPONG_HALVES;

  // Center of west half
  const westMidX = (west.minX + west.maxX) / 2;
  const midZ = (west.minZ + west.maxZ) / 2;
  assert.ok(inTableHalf('west', westMidX, midZ));
  assert.ok(!inTableHalf('east', westMidX, midZ));
  assert.ok(onTableSurface(westMidX, midZ));

  // Center of east half
  const eastMidX = (east.minX + east.maxX) / 2;
  assert.ok(inTableHalf('east', eastMidX, midZ));
  assert.ok(!inTableHalf('west', eastMidX, midZ));
  assert.ok(onTableSurface(eastMidX, midZ));

  // Outside table
  assert.ok(!onTableSurface(PINGPONG_TABLE.x, PINGPONG_TABLE.z + 2.0));
  assert.ok(!onTableSurface(PINGPONG_TABLE.x + 3.0, PINGPONG_TABLE.z));
});

test('net stands in the exact middle of the table across its width', () => {
  assert.equal(PINGPONG_NET.x, PINGPONG_TABLE.x);
  assert.equal(PINGPONG_NET.y0, PINGPONG_TABLE.height);
  assert.ok(PINGPONG_NET.y1 > PINGPONG_NET.y0);
  assert.ok(PINGPONG_NET.minZ < PINGPONG_TABLE.z - PINGPONG_TABLE.width / 2);
  assert.ok(PINGPONG_NET.maxZ > PINGPONG_TABLE.z + PINGPONG_TABLE.width / 2);
});

test('every shot a solved paddle plays lands on the far half, never off the end', () => {
  // What the game used to do: fixed speeds and a fixed lift, which carried every serve and every
  // return about a metre past the far edge of a 2.74m table, so the ball only ever left the floor.
  for (const side of ['west', 'east'] as const) {
    const from = { x: side === 'west' ? PINGPONG_TABLE.x - 1.4 : PINGPONG_TABLE.x + 1.4, y: PINGPONG_TABLE.height + 0.15, z: PINGPONG_TABLE.z };
    const near = PINGPONG_TABLE.x + PINGPONG_TABLE.length / 2 - PINGPONG_TABLE.x;
    for (const aim of [-1, -0.5, 0, 0.5, 1]) {
      for (const depth of [-1, 0, 1]) {
        const to = shotTarget(side, aim, depth);
        const shot = solveShot(from, to);
        const flight = flyBall(from, shot, shot.t + 0.5);
        assert.equal(flight.where, 'bounce', `${side} shot (aim ${aim}, depth ${depth}) lands on the table, not ${flight.where} at x=${flight.at.x.toFixed(2)}`);
        assert.ok(inTableHalf(otherSide(side), flight.at.x, flight.at.z), `${side} shot (aim ${aim}, depth ${depth}) lands in the far half at x=${flight.at.x.toFixed(2)}`);
        assert.ok(flight.t <= shot.t * 1.15 + 0.05, `it comes down within the flight it was solved for (${flight.t.toFixed(3)}s vs ${shot.t.toFixed(3)}s)`);
      }
    }
    assert.ok(near > 0, 'the far half is a real target to aim into');
  }
});

test('a serve from either end clears the net and lands on the table', () => {
  for (const side of ['west', 'east'] as const) {
    for (const z of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const from = { x: side === 'west' ? PINGPONG_TABLE.x - 1.2 : PINGPONG_TABLE.x + 1.2, y: PINGPONG_TABLE.height + 0.22, z: PINGPONG_TABLE.z + z * 0.5 };
      const shot = solveShot(from, shotTarget(side, z, -0.25));
      const flight = flyBall(from, shot, shot.t + 0.5);
      assert.equal(flight.where, 'bounce', `${side} serve from z=${z} lands on the table, not ${flight.where}`);
      assert.ok(inTableHalf(otherSide(side), flight.at.x, flight.at.z), `${side} serve from z=${z} lands in the far half`);
    }
  }
});

test('a short shot just over the net still clears the tape', () => {
  const from = { x: PINGPONG_TABLE.x - 1.4, y: PINGPONG_TABLE.height + 0.15, z: PINGPONG_TABLE.z };
  // Aimed as close to the net on the far side as the table allows.
  const to = { x: PINGPONG_TABLE.x + PINGPONG_PHYSICS.edgeMargin, z: PINGPONG_TABLE.z };
  const shot = solveShot(from, to);
  const flight = flyBall(from, shot, shot.t + 0.5);
  assert.equal(flight.where, 'bounce', `the shortest legal shot is not in the net: ${flight.where}`);
});

test('each stroke flies its own ball: a smash is fast and flat, a chop floats and a loop dips', () => {
  const from = { x: PINGPONG_TABLE.x - 1.4, y: PINGPONG_TABLE.height + 0.15, z: PINGPONG_TABLE.z };
  const to = shotTarget('west', 0, 0);
  const flown = (kind: PingPongShotKind) => {
    const shot = solveShot(from, to, kind);
    return { shot, flight: flyBall(from, shot, 3, { tops: shot.tops, side: shot.side }) };
  };
  const smash = flown('smash');
  const loop = flown('topspin');
  const chop = flown('backspin');

  assert.ok(Math.abs(smash.shot.vx) > Math.abs(loop.shot.vx), `a smash is struck harder than a loop (${smash.shot.vx.toFixed(2)} vs ${loop.shot.vx.toFixed(2)})`);
  assert.ok(chop.shot.t > loop.shot.t, 'a chopped ball is up longer than a looped one');
  for (const [kind, r] of Object.entries({ smash, topspin: loop, backspin: chop }) as [PingPongShotKind, ReturnType<typeof flown>][])
    assert.equal(r.flight.where, 'bounce', `a ${kind} lands on the table, not ${r.flight.where}`);

  // Spin is carried, and it is what makes the difference: a topped ball is pulled down and kicks up
  // off the table, a cut one floats and skids.
  assert.ok(loop.shot.tops > 0 && chop.shot.tops < 0, 'a loop is over the ball and a chop under it');
  const drop = (tops: number) => {
    const b = { x: PINGPONG_TABLE.x - 1.4, y: PINGPONG_TABLE.height + 0.6, z: PINGPONG_TABLE.z, vx: 3, vy: 0, vz: 0, tops, side: 0 };
    const start = b.y;
    for (let i = 0; i < 12; i++) flyStep(b, 1 / 60);
    return start - b.y;
  };
  assert.ok(drop(1.7) > drop(0), 'a topped ball dips further than a flat one over the same time');
  const bounce = (tops: number) => {
    const b = { x: PINGPONG_TABLE.x - 0.5, y: PINGPONG_TABLE.height, z: PINGPONG_TABLE.z, vx: 3, vy: -2, vz: 0, tops, side: 0 };
    tableBounce(b);
    return { up: b.vy, on: b.vx };
  };
  assert.ok(bounce(1.7).up > bounce(0).up, 'a topped ball kicks up higher off the table');
  assert.ok(bounce(1.7).on > bounce(0).on, 'and carries on faster');
  assert.ok(bounce(-1.3).up < bounce(0).up, 'a cut ball skids and dies');
  assert.ok(PINGPONG_SPIN.kick > 1 && PINGPONG_SPIN.skid < 1, 'the spin model says which way each goes');
});

test('you have to walk to the ball: your feet stay on your own end of the table', () => {
  const spot = PINGPONG_SPOTS.west;
  assert.ok(onCourt('west', spot.x, spot.z), 'your spot is on your own end');
  assert.ok(!onCourt('west', PINGPONG_TABLE.x, PINGPONG_TABLE.z), 'the middle of the table is not');
  assert.ok(!onCourt('west', PINGPONG_TABLE.x + 2, PINGPONG_TABLE.z), 'nor is the far end');
  assert.ok(!onCourt('west', spot.x, spot.z + PINGPONG_COURT.across + 0.5), 'nor is the end of the table');

  // Every step you take is clamped back onto that ground.
  const wide = onCourtSpot('west', spot.x + 5, spot.z + 5);
  assert.ok(onCourt('west', wide.x, wide.z), 'walking off the court puts you back on it');
  assert.ok(wide.x <= spot.x + PINGPONG_COURT.forward + 1e-9, 'and no further forward than your reach');
  assert.ok(wide.z <= spot.z + PINGPONG_COURT.across + 1e-9, 'and no further across than your reach');

  // And the far end has its own, mirrored, ground: the two never overlap.
  assert.ok(!onCourt('west', PINGPONG_SPOTS.east.x, PINGPONG_SPOTS.east.z));
  assert.ok(onCourt('east', PINGPONG_SPOTS.east.x, PINGPONG_SPOTS.east.z));
});

test('the bot reads where the ball is going, not where it is', () => {
  // A ball struck at the far end: the bot should already be walking to where it will cross its bat,
  // not standing where the ball happens to be at the moment.
  const ball = { x: PINGPONG_TABLE.x - 1.4, y: PINGPONG_TABLE.height + 0.25, z: PINGPONG_TABLE.z + 0.3, vx: 3.2, vy: 2, vz: 0.6, tops: 1.2, side: 0 };
  const meet = meetPoint(ball, 'east');
  assert.ok(meet, 'the ball reaches the east bat');
  assert.ok(Math.abs(meet.z - PINGPONG_TABLE.z) > 0.2, `it is met away from the middle (z=${meet.z.toFixed(2)} against ${PINGPONG_TABLE.z})`);

  const bot = new TableTennisBot('pro');
  bot.reset('east');
  for (let i = 0; i < 10; i++) bot.look(1, 1 / 60);
  const plan = bot.plan(ball, 'east', { x: PINGPONG_TABLE.x - 2, z: PINGPONG_TABLE.z - 0.6 });
  assert.ok(plan.stroke, 'it has decided what to play');
  assert.ok(Math.abs(plan.to.z - meet.z) < PINGPONG_COURT.across + 1, 'it walks to the ball');
  assert.ok(onCourt('east', plan.to.x, plan.to.z), 'and stays on its own end while doing it');

  // It goes for the side the player has left open, not the middle.
  assert.ok(Math.sign(plan.aim.z - PINGPONG_TABLE.z) === Math.sign(PINGPONG_TABLE.z - (PINGPONG_TABLE.z - 0.6)), `it aims away from where the player is standing (z=${plan.aim.z.toFixed(2)})`);
});

test('TableTennisMatch: joining in bot mode creates an automated AI worker bot opponent', () => {
  const match = new TableTennisMatch();
  assert.equal(match.state().active, false);

  const joined = match.join('player1', 'Alice', 'west', 'bot', 'Worker Bot (Bolt)', 'normal');
  assert.ok(joined);

  const state = match.state();
  assert.ok(state.active);
  assert.equal(state.mode, 'bot');
  assert.equal(state.westPlayer?.name, 'Alice');
  assert.equal(state.eastPlayer?.isBot, true);
  assert.equal(state.eastPlayer?.name, 'Worker Bot (Bolt)');
  assert.equal(state.status, 'serve');
  assert.equal(state.server, 'west');
});

test('TableTennisMatch: joining in pvp mode waits for second player before serve', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'pvp');
  assert.equal(match.state().status, 'waiting');

  match.join('p2', 'Bob', 'east', 'pvp');
  assert.equal(match.state().status, 'serve');
  assert.equal(match.state().westPlayer?.name, 'Alice');
  assert.equal(match.state().eastPlayer?.name, 'Bob');
});

test('TableTennisMatch: serving and hitting increments rally and sets ball state', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');

  const serveRes = match.serve('p1', 'west', 4.5, 3.2, 0.2);
  assert.ok(serveRes);
  assert.equal(match.state().status, 'rally');
  assert.equal(match.state().rally, 1);
  assert.equal(match.state().lastHitBy, 'west');

  const hitRes = match.hit('bot', 'east', 7.2, 0.85, 15.0, -4.8, 3.0, -0.1);
  assert.ok(hitRes);
  assert.equal(match.state().rally, 2);
  assert.equal(match.state().lastHitBy, 'east');
});

test('TableTennisMatch: a game runs to 11 by two, then the score is reset and a game is on the board', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');
  // A point can only be scored out of a rally somebody struck, and the strike has to be the serve
  // that side is due: two serves each, then the other end serves.
  const point = (winner: PingPongSide) => {
    const side = match.state().server;
    assert.ok(match.serve('p1', side, 3, 2, 0), `the ${side} side can serve`);
    return match.awardPoint('p1', winner);
  };

  point('west');
  assert.deepEqual(match.state().score, { west: 1, east: 0 });
  assert.equal(match.state().server, 'west', 'the same side serves twice');

  point('west');
  assert.deepEqual(match.state().score, { west: 2, east: 0 });
  assert.equal(match.state().server, 'east', 'then the other end serves');

  // 9 more for west and 9 for east takes it to 10-9, one point from the game.
  for (let i = 0; i < 8; i++) point('west');
  for (let i = 0; i < 9; i++) point('east');
  assert.deepEqual(match.state().score, { west: 10, east: 9 });
  assert.deepEqual(match.state().games, { west: 0, east: 0 });

  // 11-9 wins the game, not the match: the points reset and a game goes on the board.
  const game = point('west');
  assert.equal(game?.gameWon, true);
  assert.equal(game?.matchWon, false, 'one game is not the match');
  assert.deepEqual(match.state().score, { west: 0, east: 0 });
  assert.deepEqual(match.state().games, { west: 1, east: 0 });
  assert.equal(match.state().server, 'west', 'the winner of the game serves the next one');
  assert.equal(match.state().status, 'point');
});

test('TableTennisMatch: the match is over once one side has won three games', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');
  const winGame = () => {
    for (let i = 0; i < 11; i++) {
      const side = match.state().server;
      assert.ok(match.serve('p1', side, 3, 2, 0));
      match.awardPoint('p1', 'west');
    }
  };
  winGame();
  winGame();
  assert.deepEqual(match.state().games, { west: 2, east: 0 });
  assert.equal(match.state().status, 'point');

  winGame();
  assert.deepEqual(match.state().games, { west: 3, east: 0 });
  assert.equal(match.state().status, 'ended');
  assert.equal(match.state().winner, 'west');
  assert.ok(match.state().winner, 'the match has a winner on the board');
});

test('TableTennisMatch: only the side due to serve can serve', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');
  assert.equal(match.serve('p1', 'east', 3, 2, 0), null, 'the west player cannot serve from the east end');
  assert.ok(match.serve('p1', 'west', 3, 2, 0), 'the side due can serve');
});

test('TableTennisMatch: a point is only scored by a player, once per strike', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');

  // Nobody struck a ball: no point, however it is claimed.
  assert.equal(match.awardPoint('p1', 'east'), null);
  assert.deepEqual(match.state().score, { west: 0, east: 0 });

  // A client that isn't in the match cannot hand out its points either.
  match.serve('p1', 'west', 3, 2, 0);
  assert.equal(match.awardPoint('someone-else', 'east'), null);
  assert.deepEqual(match.state().score, { west: 0, east: 0 });

  // The rally's own player scores it, and the strike is spent with the point.
  assert.ok(match.awardPoint('p1', 'east', 'Out'));
  assert.deepEqual(match.state().score, { west: 0, east: 1 });
  assert.equal(match.awardPoint('p1', 'east', 'Out'), null, 'the same strike cannot be paid out twice');
  assert.deepEqual(match.state().score, { west: 0, east: 1 });
});

test('TableTennisMatch: a shot from a client is corrected, not obeyed', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');

  // A west player's ball travels east; one sent back the other way is turned round.
  const away = match.serve('p1', 'west', 3, 2, 0);
  assert.ok(away && away.ball.vx > 0, `a serve from the west travels east, vx=${away?.ball.vx}`);
  const back = match.hit('bot', 'east', 7.4, 0.9, 15, -3, 2, 0);
  assert.ok(back && back.ball.vx < 0, `a return from the east travels west, vx=${back?.ball.vx}`);
  // Nonsense from a client is replaced with something playable rather than flown off the floor.
  const wild = match.hit('p1', 'west', 4.6, 0.9, 15, Number.NaN, 900, 0);
  assert.ok(wild && Number.isFinite(wild.ball.vy) && wild.ball.vy <= 8, `lift is bounded, vy=${wild?.ball.vy}`);
});

test('TableTennisMatch: leaving clears players and resets match state', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'pvp');
  match.join('p2', 'Bob', 'east', 'pvp');

  match.leave('p1');
  assert.equal(match.state().westPlayer, undefined);
  assert.equal(match.state().status, 'waiting');

  match.leave('p2');
  assert.equal(match.state().active, false);

  // In bot mode, leaving immediately clears the active match
  const botMatch = new TableTennisMatch();
  botMatch.join('p1', 'Alice', 'west', 'bot');
  assert.equal(botMatch.state().active, true);
  botMatch.leave('p1');
  assert.equal(botMatch.state().active, false);
});
