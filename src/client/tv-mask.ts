/**
 * The picture's occlusion mask: which parts of the TV's picture something is standing in front of.
 * Ordinary HTML can't be depth-tested against the scene, and the TV is only ever a metre or two from
 * a wall, a desk, a plant or a person, so the picture is cut up into a grid of cells and each cell is
 * asked whether the way from your eye to it runs through anything. The answer is a byte a cell — 255
 * where the picture shows, 0 where it's spoken for — which tvscreen.ts hands the browser as the
 * frame's own `mask-image`.
 *
 * It is all arithmetic over numbers, with no DOM in it, so it can be measured and tested without a
 * browser. That matters, because this is the office's hottest little loop when a link is playing: it
 * runs for every cell of the picture against everything that could reach it, a dozen times a second.
 * So the cells' places in the world are worked out once (the TV's screen never moves), the people are
 * read once a pass rather than once a cell, and `blocks` allocates nothing.
 */
import * as THREE from 'three';
import { blocks } from './tv-projection';
import type { Collider } from './world/office';

/** The grid the picture's occlusion is worked out on, one cell per mask pixel (the TV is 16:9 too). */
export const MASK_W = 96;
export const MASK_H = 54;

/**
 * Where the cells are and what each one came to. `points` is the cells' places in the world, three
 * numbers a cell in reading order (row 0 the top of the picture, as the mask is stretched over the
 * frame), and `alpha` what each one came to: 255 shows, 0 hides.
 */
export interface MaskGrid {
  readonly width: number;
  readonly height: number;
  readonly points: Float32Array;
  readonly alpha: Uint8Array;
  /** The middle of the picture, in the world, and how far the picture spreads either side of it. */
  readonly centre: THREE.Vector3;
  readonly radius: number;
}

/**
 * The grid for `mesh`'s screen, worked out once. `mesh`'s world matrix has to be up to date, and the
 * cell centres are the screen's own rectangle stepped across in reading order — the mask is stretched
 * over the frame as it is, so row 0 is the top of the picture.
 */
export function maskGrid(mesh: THREE.Mesh, width = MASK_W, height = MASK_H): MaskGrid {
  const { geometry } = mesh;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const points = new Float32Array(width * height * 3);
  const at = new THREE.Vector3();
  const x0 = box.min.x;
  const spanX = box.max.x - box.min.x;
  const spanY = box.max.y - box.min.y;
  let i = 0;
  for (let my = 0; my < height; my++) {
    const y = box.max.y - ((my + 0.5) / height) * spanY;
    for (let mx = 0; mx < width; mx++) {
      at.set(x0 + ((mx + 0.5) / width) * spanX, y, 0).applyMatrix4(mesh.matrixWorld);
      points[i++] = at.x;
      points[i++] = at.y;
      points[i++] = at.z;
    }
  }
  return {
    width,
    height,
    points,
    alpha: new Uint8Array(width * height),
    centre: new THREE.Vector3(box.min.x + spanX / 2, box.min.y + spanY / 2, 0).applyMatrix4(mesh.matrixWorld),
    radius: Math.hypot(spanX, spanY) / 2,
  };
}

/**
 * Fills the grid's `alpha` from what `eye` can see of it: 0 for every cell whose way from the eye
 * runs through one of `way` (the walls, desks and plants already narrowed down to those that could
 * reach the picture), one of `bodies` (the people, who aren't colliders), or over your own hands, as
 * `hands(u, v)` says for the cell's place across and down the picture. Returns how many cells are
 * hidden: all of them means the picture is out of sight entirely.
 */
export function fillMask(
  grid: MaskGrid,
  eye: THREE.Vector3,
  way: readonly Collider[],
  bodies: readonly Collider[],
  hands: ((u: number, v: number) => boolean) | null,
): number {
  const { width, height, points, alpha } = grid;
  const at = new THREE.Vector3();
  let hidden = 0;
  for (let cell = 0; cell < width * height; cell++) {
    at.set(points[cell * 3], points[cell * 3 + 1], points[cell * 3 + 2]);
    let blocked = false;
    for (const c of way) {
      if (blocks(eye, at, c)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      for (const b of bodies) {
        if (blocks(eye, at, b)) {
          blocked = true;
          break;
        }
      }
    }
    if (!blocked && hands) {
      const u = ((cell % width) + 0.5) / width;
      const v = (((cell / width) | 0) + 0.5) / height;
      blocked = hands(u, v);
    }
    alpha[cell] = blocked ? 0 : 255;
    if (blocked) hidden++;
  }
  return hidden;
}

/**
 * Which of the people on your floor could be standing in the way at all. A person is a box where they
 * are, and the picture is only ever in front of you from the lounge: so a person can only be in the way
 * if their box is in the wedge between your eye and the screen, which grows no wider than the screen's
 * own half-diagonal `radius`. That test is two slab tests, and it keeps everyone standing at a desk on
 * the far side of the office out of a loop they could never be in — the same cull `inTheWay` does for
 * the furniture.
 */
export function cullBodies(bodies: readonly Collider[], eye: THREE.Vector3, centre: THREE.Vector3, radius: number): Collider[] {
  const out: Collider[] = [];
  for (const b of bodies) if (blocks(eye, centre, b, radius)) out.push(b);
  return out;
}
