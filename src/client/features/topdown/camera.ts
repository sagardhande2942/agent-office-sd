import * as THREE from 'three';

export const isTopdownRoute = () => ['/2d', '/2d.html', '/game2d.html'].includes(location.pathname);

/** Orthographic exploration, with the existing perspective camera contract for activities. */
export class PlanCamera extends THREE.OrthographicCamera {
  aspect = 1;
  fov = 55;
  span = 30;
  perspective = false;
  readonly isPerspectiveCamera!: boolean;
  private readonly activityCamera = new THREE.PerspectiveCamera();

  constructor(near: number, far: number) {
    super(-15, 15, 15, -15, near, far);
    // Raycaster and the renderer must use the projection currently on screen.
    Object.defineProperty(this, 'isOrthographicCamera', { get: () => !this.perspective });
    Object.defineProperty(this, 'isPerspectiveCamera', { get: () => this.perspective });
  }

  override updateProjectionMatrix() {
    // OrthographicCamera calls this during super(), before the activity camera exists.
    if (this.perspective && this.activityCamera) {
      Object.assign(this.activityCamera, { fov: this.fov, aspect: this.aspect, near: this.near, far: this.far });
      this.activityCamera.updateProjectionMatrix();
      this.projectionMatrix.copy(this.activityCamera.projectionMatrix);
      this.projectionMatrixInverse.copy(this.activityCamera.projectionMatrixInverse);
    } else {
      const half = (this.span ?? 30) / 2, aspect = this.aspect ?? 1;
      this.left = -half * aspect; this.right = half * aspect;
      this.top = half; this.bottom = -half;
      super.updateProjectionMatrix();
    }
  }
}
export type SceneCamera = THREE.PerspectiveCamera | PlanCamera;
