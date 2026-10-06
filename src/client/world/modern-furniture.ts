import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALCONY, DESKS, DESK_SIZE, EXIT_STAIRS, FLOOR, PLANTS, STREET_Y, WALL_HEIGHT, WINDOWS, type DeskDef } from '../../shared/layout';
import type { Theme } from '../../shared/protocol';
import { mulberry32 } from '../../shared/rng';
import { batWingGeometry, glowTexture } from './costumes';
import { buildDesk, plantLeaves, type Collider, type Office } from './office';
import { SPOOKY_MOON } from './sky';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from './toon';
import { FROST, RACK_GLASS, SCREEN_LEN, SCREEN_H, Holiday } from './holiday';


// ---- The modern office -------------------------------------------------------------------------

/** The cool white the modern office's LED strips and coves glow in. */
export function ledMaterial(color: string): THREE.MeshToonMaterial {
  const m = toonUnique(color);
  m.emissive.set(color);
  m.emissiveIntensity = 0.7;
  m.userData.outlineParameters = { visible: false };
  return m;
}


/** A frosted-glass desk screen: a pane in the seam between two benches, on a slim rail, lit underneath. */
export function benchScreen(led: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const y0 = DESK_SIZE.height;
  const rail = toon('#c3ccd4');
  g.add(mesh(new THREE.BoxGeometry(SCREEN_LEN, SCREEN_H, 0.035), FROST, 0, y0 + SCREEN_H / 2, 0, false));
  g.add(mesh(new THREE.BoxGeometry(SCREEN_LEN + 0.08, 0.045, 0.07), rail, 0, y0 + SCREEN_H + 0.02, 0));
  g.add(mesh(new THREE.BoxGeometry(SCREEN_LEN - 0.12, 0.014, 0.02), led, 0, y0 + SCREEN_H - 0.03, 0.03, false));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.13), rail, (sx * SCREEN_LEN) / 2, y0 + 0.03, 0));
  return g;
}


/** A server rack: a dark cabinet with a glass door and rows of status LEDs, facing +z. */
export function serverRack(): { group: THREE.Group; leds: THREE.MeshToonMaterial[] } {
  const g = new THREE.Group();
  const W = 0.8;
  const D = 0.7;
  const H = 1.5;
  const shell = toon('#3b4249');
  g.add(mesh(new THREE.BoxGeometry(W, H, D), shell, 0, H / 2, 0));
  // A recessed front, with the door glass over it, a vent grille on top and feet under it.
  g.add(mesh(new THREE.BoxGeometry(W - 0.1, H - 0.16, 0.06), toon('#20252a'), 0, H / 2, D / 2 - 0.02, false));
  g.add(mesh(new THREE.BoxGeometry(W - 0.14, H - 0.2, 0.02), RACK_GLASS, 0, H / 2, D / 2 + 0.01, false));
  const trim = toon('#59636c');
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.BoxGeometry(W - 0.16, 0.02, 0.03), trim, 0, H + 0.005, -0.2 + i * 0.1, false));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.06, 0.07), trim, sx * (W / 2 - 0.06), 0.03, 0));
  // The status LEDs, in rows in front of the glass, in three colors that flicker apart (see update).
  const leds = ['#5dff8a', '#6ee7ff', '#ffd166'].map(ledMaterial);
  const blink = new THREE.Group();
  const bulb = new THREE.BoxGeometry(0.028, 0.02, 0.012);
  for (let r = 0; r < 6; r++) {
    for (let i = 0; i < 5; i++) blink.add(mesh(bulb, leds[(r + i) % leds.length], -0.28 + i * 0.14, 0.2 + r * 0.22, D / 2 + 0.035, false));
  }
  g.add(mergeByMaterial(blink));
  return { group: g, leds };
}


/** A water cooler: a stand with two taps and a big bottle on top, facing +z. */
export function waterCooler(): THREE.Group {
  const g = new THREE.Group();
  const body = toon('#e9eef2');
  const trim = toon('#b9c2c9');
  const W = 0.4;
  const D = 0.4;
  const H = 0.95;
  g.add(mesh(new THREE.BoxGeometry(W, H, D), body, 0, H / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(W * 0.8, 0.22, 0.02), trim, 0, H - 0.18, D / 2 + 0.005, false));
  for (const [sx, color] of [
    [-0.07, '#3a86ff'],
    [0.07, '#ef476f'],
  ] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8), toon(color), sx, H - 0.3, D / 2 + 0.05, false));
  }
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.14), trim, 0, 0.02, D / 2 + 0.05));
  // The bottle, neck down in its collar on top.
  const water = toon('#8ecae6');
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 12), trim, 0, H + 0.06, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.42, 16), water, 0, H + 0.3, 0));
  g.add(mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), water, 0, H + 0.51, 0));
  return g;
}


/** Slim LED coves tucked in where each wall meets the ceiling. */
export function ceilingCoves(led: THREE.Material): THREE.Group {
  const y = WALL_HEIGHT - 0.24;
  const inset = 0.3;
  const t = 0.06;
  const along = (w: number, d: number, x: number, z: number) => mesh(new THREE.BoxGeometry(w, 0.05, d), led, x, y, z, false);
  const g = new THREE.Group();
  g.add(along(FLOOR.maxX - FLOOR.minX - 2 * inset, t, 0, FLOOR.minZ + inset), along(FLOOR.maxX - FLOOR.minX - 2 * inset, t, 0, FLOOR.maxZ - inset));
  g.add(along(t, FLOOR.maxZ - FLOOR.minZ - 2 * inset, FLOOR.minX + inset, 0), along(t, FLOOR.maxZ - FLOOR.minZ - 2 * inset, FLOOR.maxX - inset, 0));
  return mergeByMaterial(g);
}


/** How bright the server rack's LED `i` is at `t`: a slow flicker, each in a rhythm of its own. */
export function rackGlow(t: number, i: number): number {
  return 0.25 + 1.5 * (0.5 + 0.5 * Math.sin(t * (7 + i * 4) + i * 2.1));
}


/**
 * The modern office's furniture, laid out as the props lab shows it: a frosted screen standing in
 * the seam between two back-to-back benches, the server rack and the water cooler. `update` flickers
 * the rack's LEDs, as Holiday.update does in the office.
 */
export function modernFurniture(): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const led = ledMaterial('#9fdcff');
  const bench = new THREE.Group();
  const desk = (def: DeskDef, z: number, rotY: number) => {
    const d = buildDesk({ ...def, x: 0, z, rotY }, 1, toon('#8ecae6'));
    d.vacancy.visible = false;
    return d.group;
  };
  bench.add(desk(DESKS[0], 0.55, 0), desk(DESKS[0], -0.55, Math.PI), benchScreen(led));
  group.add(bench);
  const rack = serverRack();
  rack.group.position.set(3.4, 0, 0);
  group.add(rack.group);
  const cooler = waterCooler();
  cooler.position.set(-2.7, 0, 0);
  group.add(mergeByMaterial(cooler));
  const update = (t: number) => rack.leds.forEach((m, i) => (m.emissiveIntensity = rackGlow(t, i)));
  update(0);
  return { group, update };
}
