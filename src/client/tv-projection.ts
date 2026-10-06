import * as THREE from 'three';
import { TV } from '../shared/layout';
import { TV_OFF, classify, embedUrl, positionAt, youtubeId, type TvKind, type TvState } from '../shared/tv';
import { DrunkPicture } from './drunkframe';
import { roomMediaGain } from './spatial-audio';
import { store } from './state';
import { h, toast } from './ui/dom';
import type { Collider } from './world/office';


/**
 * The 2D transform taking four points to four others, as `[a, b, c, d, e, f, g, h]` for the matrix
 * `[[a b c], [d e f], [g h 1]]` — a CSS `matrix3d`, solved the long way so any four corners work.
 * Returns null when they're flat against the camera, where no planar transform will do.
 */
export function homography(from: readonly (readonly [number, number])[], to: readonly (readonly [number, number])[]): number[] | null {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss-Jordan, with partial pivoting so a near-edge-on screen doesn't come out as noise.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-6) return null;
    if (pivot !== col) [rows[pivot], rows[col]] = [rows[col], rows[pivot]];
    const lead = rows[col][col];
    for (let k = col; k < 9; k++) rows[col][k] /= lead;
    for (let row = 0; row < 8; row++) {
      if (row === col || !rows[row][col]) continue;
      const times = rows[row][col];
      for (let k = col; k < 9; k++) rows[row][k] -= times * rows[col][k];
    }
  }
  return rows.map((r) => r[8]);
}


/** Whether the way from `eye` to the TV runs through `c` (a wall, the loft's floor, a desk…). */
export function blocks(eye: THREE.Vector3, to: THREE.Vector3, c: Collider): boolean {
  const from = [eye.x, eye.y, eye.z];
  const delta = [to.x - eye.x, to.y - eye.y, to.z - eye.z];
  const low = [c.minX, c.bottom ?? 0, c.minZ];
  const high = [c.maxX, c.top, c.maxZ];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(delta[i]) < 1e-9) {
      if (from[i] < low[i] || from[i] > high[i]) return false;
      continue;
    }
    let a = (low[i] - from[i]) / delta[i];
    let b = (high[i] - from[i]) / delta[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
