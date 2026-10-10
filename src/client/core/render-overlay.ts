import type { WebGLRenderer } from 'three';

/** Draw an overlay above the world without clearing the world's color buffer. */
export function renderOverlay(renderer: WebGLRenderer, draw: () => void): void {
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  try {
    renderer.clearDepth();
    draw();
  } finally {
    renderer.autoClear = autoClear;
  }
}
