// The room's light in the three settings the switch by the TV walks through: how much of it is left,
// how warm it has gone, and that coming back to lights-up is exactly where it started. The settings
// are the feature's own (src/client/features/tv/lighting.ts); the light itself is the sky's
// (src/client/world/sky.ts). Both are pure, so both can be checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TV_LIGHT_ORDER, TV_LIGHTS, type TvLight } from '../src/shared/tv.js';
import { ROOM_DIM, ROOM_LIT, ROOM_WARM, luma, roomLevel } from '../src/client/world/sky.js';
import { ROOM_LIGHT, roomLightFor } from '../src/client/features/tv/lighting.js';

/** The colour the shader's `skyRoom` ends up in for a setting, as linear RGB. */
const room = (mode: TvLight) => ROOM_WARM.clone().lerp(ROOM_LIT, 1 - ROOM_LIGHT[mode].warm).multiplyScalar(roomLevel(ROOM_LIGHT[mode].down));

test('the three settings are three amounts of the room’s own light, and each is dimmer than the last', () => {
  assert.equal(ROOM_LIGHT.bright.down, 0, 'lights up leaves the room exactly as it was');
  assert.equal(ROOM_LIGHT.bright.warm, 0);
  assert.equal(ROOM_LIGHT.off.down, 1, 'lights out is all the way down, as it always was');
  assert.ok(ROOM_LIGHT.dim.down > 0 && ROOM_LIGHT.dim.down < 1, 'the middle setting is in between');
  // Up, then the warm dim, then out: less light each step, whatever order they are asked in.
  const levels = TV_LIGHT_ORDER.map((m) => roomLevel(ROOM_LIGHT[m].down));
  assert.ok(levels[0] > levels[1] && levels[1] > levels[2], `${levels.join(' then ')}`);
  assert.equal(levels[2], 1 - ROOM_DIM, 'the lights-out mode is the one the switch has always given');
});

test('the middle setting is dim enough to be a different mood and bright enough to see by', () => {
  const dim = ROOM_LIGHT.dim.down * ROOM_DIM;
  // A little over half the room's light: the desks, the walkways and the workers at them are all
  // plainly there, which is what somebody watching a film in the office actually needs.
  assert.ok(dim > 0.3 && dim < 0.55, `${(roomLevel(ROOM_LIGHT.dim.down) * 100).toFixed(0)}% of the room's light is left`);
  assert.ok(roomLevel(ROOM_LIGHT.dim.down) > 0.4);
  // It is warm white, not a blue screen: red and green up, blue down.
  assert.ok(ROOM_WARM.r > ROOM_WARM.b, 'the warm tint is warmer at the red end');
  assert.ok(ROOM_WARM.g > ROOM_WARM.b, 'and at the green end');
  // ...and the tint costs no light of its own, so only `down` says how much of the room is left.
  assert.ok(Math.abs(luma(ROOM_WARM.r, ROOM_WARM.g, ROOM_WARM.b) - 1) < 1e-6, 'the warm tint is as bright as the light it stands in for');
  // The lights-out mode is left exactly as dark and as neutral as it always was.
  assert.deepEqual(room('off').toArray(), [1 - ROOM_DIM, 1 - ROOM_DIM, 1 - ROOM_DIM]);
});

test('the room’s light is worked out from the setting, never off what the last frame left', () => {
  // Asking for lights up gives the whole of it, every colour full — so however often the switch has
  // been thrown, coming back is exact rather than a little darker each time.
  assert.deepEqual(room('bright').toArray(), [1, 1, 1]);
  // Same answer whatever order the settings were asked for in: nothing is multiplied onto the last.
  const there = room('dim').getHex();
  for (const mode of TV_LIGHT_ORDER) room(mode);
  assert.equal(room('dim').getHex(), there);
  for (let i = 0; i < 10; i++) room('off');
  assert.deepEqual(room('bright').toArray(), [1, 1, 1]);
  assert.equal(room('dim').getHex(), there);
  // Out of range on the way in is the nearest end of it, never a colour outside the range.
  assert.equal(roomLevel(-1), 1);
  assert.equal(roomLevel(2), 1 - ROOM_DIM);
});

test('the switch only asks for the room’s light while you’re on this floor', () => {
  assert.deepEqual(roomLightFor('off', true), ROOM_LIGHT.off);
  // Up on the roof or out in a hall of another map’s, there is no office room to dim.
  assert.deepEqual(roomLightFor('off', false), ROOM_LIGHT.bright);
  assert.deepEqual(roomLightFor('dim', false), ROOM_LIGHT.bright);
});

test('every setting has a name, an icon and something to say about it', () => {
  assert.deepEqual(TV_LIGHT_ORDER.map((m) => TV_LIGHTS[m].label), ['Lights up', 'Warm dim', 'Lights out']);
  assert.deepEqual(TV_LIGHT_ORDER.map((m) => TV_LIGHTS[m].icon), ['💡', '🕯️', '🎬']);
  assert.match(TV_LIGHTS.dim.note, /warm/i);
  assert.match(TV_LIGHTS.dim.note, /desks|walkways/i, 'the middle setting says why it is worth having');
  assert.match(TV_LIGHTS.off.note, /picture/i);
});
