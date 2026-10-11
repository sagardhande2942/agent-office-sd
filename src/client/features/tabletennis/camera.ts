import * as THREE from 'three';
import type { SceneCamera } from '../topdown/camera';
import type { TableTennisController } from './controller';
import { PINGPONG_TABLE } from '../../../shared/tabletennis';

/** A court view, independent of shot aim: keep the table and high balls inside the frame. */
export class TableTennisCamera {
  private savedFov?: number;
  private target = new THREE.Vector3();
  private local = new THREE.Vector3();
  constructor(private camera: SceneCamera, private controller: TableTennisController) {}
  update() {
    const c = this.controller, camera = this.camera;
    if (!c.active) {
      if (this.savedFov !== undefined) { camera.fov = this.savedFov; camera.updateProjectionMatrix(); this.savedFov = undefined; }
      return;
    }
    this.savedFov ??= camera.fov;
    const dir = c.side === 'west' ? 1 : -1, table = PINGPONG_TABLE;
    // Follow your feet from behind and above; turning to aim never turns the court out of view.
    this.target.set(table.x, 1.15 + Math.max(0, c.ballInPlay ? c.ballPos.y - 1.8 : 0) * 0.35, table.z);
    const points = c.ballInPlay ? [c.ballPos] : [];
    for (const x of [-(table.length / 2), (table.length / 2)]) for (const z of [-(table.width / 2), (table.width / 2)])
      points.push(new THREE.Vector3(table.x + x, table.height, table.z + z));
    let required = 52;
    for (let back = 1.2; back <= 8; back += 0.3) {
      camera.position.set(c.where.x - dir * back, 2.8, c.where.z);
      camera.lookAt(this.target); camera.updateMatrixWorld();
      required = 52;
      for (const point of points) {
        this.local.copy(point).applyMatrix4(camera.matrixWorldInverse);
        const depth = Math.max(0.1, -this.local.z);
        const tangent = Math.max(Math.abs(this.local.y) / depth, Math.abs(this.local.x) / (depth * camera.aspect));
        required = Math.max(required, THREE.MathUtils.radToDeg(2 * Math.atan(tangent * 1.2)));
      }
      if (required <= 70) break;
    }
    const fov = Math.min(80, required);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
