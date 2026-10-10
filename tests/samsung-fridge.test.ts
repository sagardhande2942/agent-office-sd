import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { statSync } from 'node:fs';
import { samsungFridge } from '../src/client/world/samsung-fridge/controller';
import { openModel } from './glb';

function fixture() {
  const scene = new Group();
  for (const name of ['fridge_left_hinge', 'fridge_right_hinge', ...Array.from({ length: 5 }, (_, i) => `fridge_can_${i}`)]) {
    const node = new Group(); node.name = name; scene.add(node);
  }
  return { scene, fridge: samsungFridge(scene, { x: -11.3, z: 12.2, rotY: Math.PI })! };
}

test('Samsung fridge swings both doors outward, reverses mid-swing and respects reduced motion', () => {
  const { scene, fridge } = fixture();
  const left = scene.getObjectByName('fridge_left_hinge')!, right = scene.getObjectByName('fridge_right_hinge')!;
  assert.equal(fridge.toggle(), true); fridge.update(0.2);
  assert.ok(left.rotation.y < 0 && left.rotation.y > -2.02);
  assert.equal(right.rotation.y, -left.rotation.y);
  fridge.toggle(); fridge.update(1);
  assert.equal(left.rotation.y, 0); assert.equal(right.rotation.y, 0);
  fridge.toggle(true); assert.equal(left.rotation.y, -2.02); assert.equal(right.rotation.y, 2.02);
  fridge.toggle(true); assert.equal(left.rotation.y, 0);
});

test('only the five front-row drinks can be taken, while open', () => {
  const { scene, fridge } = fixture();
  assert.equal(fridge.takeCan(), false); assert.equal(fridge.cans, 5);
  fridge.toggle(true);
  for (let i = 0; i < 5; i++) {
    assert.equal(fridge.takeCan(), true); assert.equal(fridge.cans, 4 - i);
    assert.equal(scene.getObjectByName(`fridge_can_${i}`)!.visible, false);
  }
  assert.equal(fridge.takeCan(), false);
  fridge.toggle(true); fridge.toggle(true); assert.equal(fridge.cans, 0);
});

test('an incomplete model declines replacement, preserving the original fridge', () => {
  assert.equal(samsungFridge(new Group(), { x: 0, z: 0 }), null);
});

test('exported fridge has moving hinges, separate drink nodes and bounded geometry', () => {
  const model = openModel('samsung-fridge');
  for (const name of ['fridge_left_hinge', 'fridge_right_hinge', ...Array.from({ length: 5 }, (_, i) => `fridge_can_${i}`)]) {
    assert.ok(model.byName(name) >= 0, name);
  }
  assert.ok(model.placed(model.byName('fridge_left_hinge')).at.x < 0);
  assert.ok(model.placed(model.byName('fridge_right_hinge')).at.x > 0);
  assert.ok(model.triangles() < 35000, 'keep detailed meshes inexpensive');
  assert.ok(statSync(new URL('../src/client/models/samsung-fridge.glb', import.meta.url)).size < 2_000_000);
  const bounds = model.bounds();
  assert.ok(bounds.min.y >= -0.001 && bounds.max.y < 1.8);
  assert.ok(bounds.max.x - bounds.min.x < 0.93);
});
