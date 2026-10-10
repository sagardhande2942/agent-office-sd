import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, MeshStandardMaterial, Texture } from 'three';
import { statSync } from 'node:fs';
import { dietCokeBottle, bottleMaterial } from '../src/client/world/samsung-fridge/bottle';
import { openModel } from './glb';

test('bottle materials retain the printed label and share dressed materials between instances', () => {
  const label = new MeshStandardMaterial({ map: new Texture() }); label.name = 'DietCoke printed label';
  const painted = bottleMaterial(label) as MeshStandardMaterial;
  assert.equal(painted.map, label.map);
  assert.notEqual(painted, label);
  assert.equal(bottleMaterial(label), painted);
  const glass = new MeshStandardMaterial({ transparent: true, opacity: .36 }); glass.name = 'DietCoke clear glass';
  assert.equal(bottleMaterial(glass).depthWrite, false);
  assert.equal(glass.depthWrite, true, 'loaded source material is not changed');
});

test('failed model loading still provides independent bottles at the requested scale', () => {
  const first = dietCokeBottle(), second = dietCokeBottle(2);
  const a = new Box3().setFromObject(first), b = new Box3().setFromObject(second);
  assert.ok(a.max.y > .22 && a.max.y < .24);
  assert.ok(Math.abs(b.max.y - a.max.y * 2) < .001);
  first.visible = false; assert.equal(second.visible, true);
});

test('bottle GLB has a label, neck and crown, with a small geometry and file budget', () => {
  const bottle = openModel('diet-coke-bottle');
  for (const material of ['DietCoke printed label', 'DietCoke clear glass', 'DietCoke silver crown']) assert.ok(bottle.materials().includes(material));
  assert.ok(bottle.triangles() < 1600);
  assert.ok(statSync(new URL('../src/client/models/diet-coke-bottle.glb', import.meta.url)).size < 250_000);
  const bounds = bottle.bounds();
  assert.ok(bounds.min.y >= -.001 && bounds.max.y > .22 && bounds.max.y < .24);
});

test('all fridge bottle stock uses shared mesh data and the five removable drink roots survive', () => {
  const fridge = openModel('samsung-fridge');
  const roots = [...Array.from({ length: 5 }, (_, i) => `fridge_can_${i}`), ...Array.from({ length: 5 }, (_, i) => `back_can_${i}`), ...Array.from({ length: 3 }, (_, i) => `stock_bottle_${i}`)];
  const meshSets = roots.map(name => {
    const i = fridge.byName(name); assert.ok(i >= 0, name);
    return fridge.nodes[i].children!.map(child => fridge.nodes[child].mesh).sort();
  });
  for (const meshes of meshSets) assert.deepEqual(meshes, meshSets[0]);
});
