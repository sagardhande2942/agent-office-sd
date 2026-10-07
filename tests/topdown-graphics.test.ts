import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphicsRatio, loadGraphics } from '../src/client/features/topdown/graphics';
import * as THREE from 'three';
import { cutaway } from '../src/client/features/topdown/cutaway';

test('2D graphics keeps current pixel ratio and bounds enhanced supersampling', () => {
  assert.equal(graphicsRatio('reduced', 1), 1);
  assert.equal(graphicsRatio('reduced', 4), 2);
  assert.equal(graphicsRatio('enhanced', 1), 2);
  assert.equal(graphicsRatio('enhanced', 2.5), 2.5);
  assert.equal(graphicsRatio('enhanced', 4), 3);
  assert.equal(graphicsRatio('enhanced', NaN), 2);
});
test('missing or blocked browser storage defaults to existing quality', () => {
  assert.equal(loadGraphics(), 'reduced');
});
test('cutaway clips shadows as well as visible ceilings and handles new materials', () => {
  const scene = new THREE.Scene(), plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.5);
  const material = new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const update = cutaway(scene, plane);
  update(); update();
  assert.equal(material.clipShadows, true);
  assert.deepEqual(material.clippingPlanes, [plane]);
  const later = new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), later)); update();
  assert.equal(later.clipShadows, true);
});
