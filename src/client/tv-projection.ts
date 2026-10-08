import type * as THREE from 'three';
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


/**
 * Whether the way from `eye` to `to` runs through `c` (a wall, the loft's floor, a desk, a person…).
 * `grow` fattens the box by that many metres all round, which is how the picture asks whether
 * something could be in the way without building a fatter copy of it (see cullBodies).
 */
export function blocks(eye: THREE.Vector3, to: THREE.Vector3, c: Collider, grow = 0): boolean {
  const floor = (c.bottom ?? 0) - grow;
  const top = c.top + grow;
  const minX = c.minX - grow;
  const maxX = c.maxX + grow;
  const minZ = c.minZ - grow;
  const maxZ = c.maxZ + grow;
  // The slab test, the three axes written out rather than looped over an array of deltas: this is
  // asked for every cell of the picture's occlusion mask against everything that could be in front of
  // it (see fillMask), five thousand times a pass, and a handful of short-lived arrays a call is tens
  // of thousands of throwaways a second for the collector to chase. The same walk, the same answer,
  // nothing allocated: `t0` and `t1` are the stretch of the ray still inside the box.
  const dx = to.x - eye.x;
  const dy = to.y - eye.y;
  const dz = to.z - eye.z;
  let t0 = 0;
  let t1 = 1;
  let a = 0;
  let b = 1;
  if (Math.abs(dx) < 1e-9) {
    if (eye.x < minX || eye.x > maxX) return false;
  } else {
    a = (minX - eye.x) / dx;
    b = (maxX - eye.x) / dx;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-9) {
    if (eye.y < floor || eye.y > top) return false;
  } else {
    a = (floor - eye.y) / dy;
    b = (top - eye.y) / dy;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (eye.z < minZ || eye.z > maxZ) return false;
  } else {
    a = (minZ - eye.z) / dz;
    b = (maxZ - eye.z) / dz;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}
