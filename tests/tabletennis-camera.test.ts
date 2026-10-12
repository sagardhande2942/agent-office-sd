import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TableTennisCamera } from '../src/client/features/tabletennis/camera.ts';
import type { TableTennisController } from '../src/client/features/tabletennis/controller.ts';

for (const side of ['west', 'east'] as const) for (const aspect of [1440 / 900, 390 / 844]) {
  test(`court camera frames high balls and restores FOV: ${side}, aspect ${aspect}`, () => {
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 100);
    const state = { active: true, ballInPlay: true, side, where: { x: side === 'west' ? 4 : 8, z: 15 }, ballPos: new THREE.Vector3() };
    const view = new TableTennisCamera(camera, state as unknown as TableTennisController);
    for (const ball of [[4, 4, 15], [8, 4, 15], [6, 1, 14.2], [6, 5, 15.7]]) {
      state.ballPos.set(...ball as [number, number, number]); view.update();
      assert.ok(camera.fov >= 52 && camera.fov <= 80);
      for (const point of [state.ballPos, new THREE.Vector3(4.63, 0.76, 14.2375), new THREE.Vector3(7.37, 0.76, 15.7625)]) {
        const projected = point.clone().project(camera);
        assert.ok(Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.9 && projected.z < 1, JSON.stringify(projected));
      }
    }
    state.ballPos.set(6, 1, 15); view.update();
    if (aspect > 1) {
      assert.equal(camera.fov, 52);
      const near = new THREE.Vector3(4.63, 0.76, 15).project(camera);
      const far = new THREE.Vector3(7.37, 0.76, 15).project(camera);
      assert.ok(Math.abs(near.y - far.y) > 0.25, 'The table must fill more of the view');
    }
    state.ballInPlay = false; state.ballPos.set(20, 0, 30); view.update();
    assert.ok(camera.fov <= 70, 'An ended ball must not pull the court view away');
    state.active = false; view.update(); assert.equal(camera.fov, 55);
  });
}
