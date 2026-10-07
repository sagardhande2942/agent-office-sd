import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlanCamera } from '../src/client/features/topdown/camera';

function ray(camera: PlanCamera, x: number) {
  camera.updateMatrixWorld();
  const caster = new THREE.Raycaster(); caster.setFromCamera(new THREE.Vector2(x, 0), camera);
  return caster.ray.clone();
}
test('top-down projection preserves scale and parallel pointer rays across the map', () => {
  const camera = new PlanCamera(0.1, 500); camera.aspect = 2; camera.span = 30; camera.updateProjectionMatrix();
  camera.position.set(0, 50, 0); camera.lookAt(0, 0, 0);
  const a = ray(camera, -0.5), b = ray(camera, 0.5);
  assert.ok(a.direction.distanceTo(b.direction) < 1e-9);
  assert.ok(Math.abs(a.origin.distanceTo(b.origin) - 30) < 1e-8);
  assert.ok(camera.isOrthographicCamera); assert.equal(camera.isPerspectiveCamera, false);
});
test('zoom and resize update projection and its inverse together', () => {
  const camera = new PlanCamera(0.1, 500); camera.aspect = 1.5; camera.span = 12; camera.updateProjectionMatrix();
  const point = new THREE.Vector3(0.4, -0.2, 0.5);
  const roundtrip = point.clone().applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.projectionMatrix);
  assert.ok(roundtrip.distanceTo(point) < 1e-8);
  assert.equal(camera.right - camera.left, 18);
});
test('camera-owning activities get perspective rays and return to flat exploration', () => {
  const camera = new PlanCamera(0.1, 500); camera.aspect = 1.6;
  camera.perspective = true; camera.updateProjectionMatrix();
  const a = ray(camera, -0.5), b = ray(camera, 0.5);
  assert.ok(a.origin.distanceTo(b.origin) < 1e-9);
  assert.ok(a.direction.distanceTo(b.direction) > 0.1);
  assert.equal(camera.isOrthographicCamera, false); assert.equal(camera.isPerspectiveCamera, true);
  camera.perspective = false; camera.updateProjectionMatrix();
  assert.ok(ray(camera, -0.5).direction.distanceTo(ray(camera, 0.5).direction) < 1e-9);
});
