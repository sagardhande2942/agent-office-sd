import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY, FLOOR } from '../src/shared/layout.js';
import {
  PINGPONG_TABLE,
  PINGPONG_NET,
  PINGPONG_HALVES,
  PINGPONG_SPOTS,
  PINGPONG_PHYSICS,
  inTableHalf,
  onTableSurface,
  defaultPingPongState,
} from '../src/shared/tabletennis.js';
import { TableTennisMatch } from '../src/server/tabletennis.js';

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

  // Player spots have clearance
  assert.ok(PINGPONG_SPOTS.west.x > BALCONY.minX + 2, 'west player spot is on balcony deck');
  assert.ok(PINGPONG_SPOTS.east.x < BALCONY.maxX - 1, 'east player spot is on balcony deck');
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

test('TableTennisMatch: score tracking, server rotation and match win', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');

  // Point 1 for west
  match.awardPoint('west', 'Ball out of bounds');
  assert.deepEqual(match.state().score, { west: 1, east: 0 });
  assert.equal(match.state().server, 'west');

  // Point 2 for west -> total points 2, server rotates to east
  match.awardPoint('west');
  assert.deepEqual(match.state().score, { west: 2, east: 0 });
  assert.equal(match.state().server, 'east');

  // Fast forward to 10-9
  for (let i = 0; i < 8; i++) match.awardPoint('west');
  for (let i = 0; i < 9; i++) match.awardPoint('east');
  assert.deepEqual(match.state().score, { west: 10, east: 9 });
  assert.equal(match.state().status, 'serve');

  // West wins 11-9 (11 points and >= 2 point lead)
  const win = match.awardPoint('west');
  assert.ok(win?.matchWon);
  assert.equal(match.state().status, 'ended');
  assert.equal(match.state().winner, 'west');
});

test('TableTennisMatch: worker bot AI computes returns toward west half with reaction delay', () => {
  const match = new TableTennisMatch();
  match.join('p1', 'Alice', 'west', 'bot');

  const ret = match.computeBotReturn('normal');
  assert.ok(ret);
  assert.ok(ret.vx < -4.0, `bot ball travels west towards player (-x), vx=${ret.vx}`);
  assert.ok(ret.vy > 2.5, `bot ball has upward lift to clear net, vy=${ret.vy}`);
  assert.ok(ret.delay >= 100 && ret.delay <= 300, `bot has realistic reaction delay: ${ret.delay}ms`);
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
