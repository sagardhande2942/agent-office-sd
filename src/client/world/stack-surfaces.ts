import * as THREE from 'three';
import { FLOOR, LADDER, POLE, POLES, SLAB, WALL_HEIGHT, WALL_T, WINDOWS, type PoleSpot } from '../../shared/layout';
import type { Collider, Interactable } from './types';
import type { Fixture } from './office/fixture';
import { mesh, textPlane, toon } from './toon';
import { Rect, Hole } from './stack';


/** `r` less the `holes` in it, as a few rectangles: rows of the grid the holes' edges make, stacked where they line up. */
export function cutRect(r: Rect, holes: Rect[]): Rect[] {
  const hs = holes
    .map((h) => ({ minX: Math.max(r.minX, h.minX), maxX: Math.min(r.maxX, h.maxX), minZ: Math.max(r.minZ, h.minZ), maxZ: Math.min(r.maxZ, h.maxZ) }))
    .filter((h) => h.maxX > h.minX && h.maxZ > h.minZ);
  const edges = (lo: number, hi: number, more: number[]) => [...new Set([lo, hi, ...more])].sort((a, b) => a - b);
  const xs = edges(r.minX, r.maxX, hs.flatMap((h) => [h.minX, h.maxX]));
  const zs = edges(r.minZ, r.maxZ, hs.flatMap((h) => [h.minZ, h.maxZ]));
  const out: Rect[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const zm = (zs[j] + zs[j + 1]) / 2;
    let run: Rect | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const xm = (xs[i] + xs[i + 1]) / 2;
      if (hs.some((h) => xm > h.minX && xm < h.maxX && zm > h.minZ && zm < h.maxZ)) {
        if (run) out.push(run);
        run = null;
      } else if (run) run.maxX = xs[i + 1];
      else run = { minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] };
    }
    if (run) out.push(run);
  }
  // Rows with the same span, one on top of the other, become one.
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (a.minX === b.minX && a.maxX === b.maxX && a.maxZ === b.minZ) {
        a.maxZ = b.maxZ;
        out.splice(j--, 1);
      }
    }
  }
  return out;
}


/** The square round a pole's hole. */
export function around(p: { x: number; z: number }, half: number): Rect {
  return { minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half };
}

export function holePath(h: Hole, flip: 1 | -1): THREE.Path {
  const p = new THREE.Path();
  if ('r' in h) p.absarc(h.x, flip * h.z, h.r, 0, Math.PI * 2, true);
  else {
    p.moveTo(h.minX, flip * h.minZ);
    p.lineTo(h.minX, flip * h.maxZ);
    p.lineTo(h.maxX, flip * h.maxZ);
    p.lineTo(h.maxX, flip * h.minZ);
    p.closePath();
  }
  return p;
}


/**
 * A flat surface with holes in it, facing up (the floor, flip -1) or down (the ceiling, flip 1).
 * Its uvs span `uv` once, like a PlaneGeometry that size would.
 */
export function surface(outline: [number, number][], holes: Hole[], flip: 1 | -1, uv?: Rect): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, flip * z)));
  shape.holes = holes.map((h) => holePath(h, flip));
  const geo = new THREE.ShapeGeometry(shape, 24);
  if (uv) {
    const pos = geo.getAttribute('position');
    const uvs = geo.getAttribute('uv');
    const w = uv.maxX - uv.minX;
    const d = uv.maxZ - uv.minZ;
    for (let i = 0; i < pos.count; i++) uvs.setXY(i, (pos.getX(i) - uv.minX) / w, (uv.maxZ - flip * pos.getY(i)) / d);
  }
  geo.rotateX(flip * (Math.PI / 2));
  return geo;
}


export function rectOutline(r: Rect): [number, number][] {
  return [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
}


/** Ceiling tiles: a light grid, one tile per repeat. */
export function tileTexture(modern = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = modern ? '#354255' : '#fbf7ef';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = modern ? '#1c2b3c' : '#e3dccf';
  g.fillRect(0, 0, 128, 5);
  g.fillRect(0, 0, 5, 128);
  // A few speckles, like the mineral fibre in real tiles.
  g.fillStyle = modern ? '#3a485b' : '#efe8dc';
  for (let i = 0; i < 40; i++) g.fillRect(8 + ((i * 53) % 116), 8 + ((i * 97) % 116), 3, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 1.2, 1 / 1.2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
