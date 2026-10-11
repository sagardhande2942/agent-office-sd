import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { withinInteractionReach } from '../src/client/input/reach';
import type { Interactable } from '../src/client/world/types';

const desk: Interactable = { kind: 'desk', x: -11.6, z: -5.8, radius: 1.3 };
const feet = new Vector3(-11.6, 0, -8.7);
const eye = feet.clone().add(new Vector3(0, 1.4, 0));

test('nearby desk screen and keyboard share reach despite different surface distances', () => {
  const screen = new Vector3(-11.6, 1.147, -4.125);
  const keyboard = new Vector3(-11.6, 0.857, -4.55);
  assert.ok(screen.distanceTo(eye) > 4.5);
  assert.ok(keyboard.distanceTo(eye) < 4.5);
  for (const hit of [screen, keyboard]) assert.ok(withinInteractionReach(desk, hit, eye, feet, 4.5));
});

test('far desks and desks on another floor remain out of reach', () => {
  const hit = new Vector3(-11.6, 1.147, -4.125);
  const far = new Vector3(-11.6, 0, -11);
  assert.equal(withinInteractionReach(desk, hit, far.clone().add(new Vector3(0, 1.4, 0)), far, 4.5), false);
  assert.equal(withinInteractionReach({ ...desk, y: 8 }, hit.clone().setY(9), eye, feet, 4.5), false);
});

test('other fixtures keep surface reach and nearer desk surfaces still work', () => {
  const hit = new Vector3(-11.6, 1.147, -4.125);
  assert.equal(withinInteractionReach({ ...desk, kind: 'seat' }, hit, eye, feet, 4.5), false);
  assert.ok(withinInteractionReach({ ...desk, z: 20 }, eye.clone(), eye, feet, 4.5));
  const thirdPersonFeet = new Vector3(-11.6, 0, -12);
  const thirdPersonEye = thirdPersonFeet.clone().add(new Vector3(0, 1.4, 0));
  assert.equal(withinInteractionReach(desk, hit, thirdPersonEye, thirdPersonFeet, 4.5), false);
  assert.ok(withinInteractionReach(desk, hit, thirdPersonEye, thirdPersonFeet, 7));
});
