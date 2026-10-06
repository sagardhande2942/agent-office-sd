import * as THREE from 'three';
import type { FloorPalette } from '../../shared/floors';
import { KIOSK, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../shared/layout';
import { BENCH_OUT, BOARD_KEYS, COUNCIL, THRONE_SIZE, type BoardKey, type MapPlan, type PropConfig } from '../../shared/maps';
import { PROP_SIZE, boxFootprint, type PropKind } from '../../shared/maps/props';
import { NavGrid, deskPoint, type Pt } from '../../shared/nav';
import { Person } from './character';
import { glowTexture } from './costumes';
import { buildGong, type Gong } from '../features/gong/world';
import { vacancyMarker, type Collider, type DeskView, type Interactable } from './office';
import { canvasTexture, seeded, shade } from './textures';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import type { World } from './world';
import { WALL, DOORWAY, asphalt, panels, neonSign, billboard, skyline, towerFace, box, toonMap, flatMap, flat, GLASS, tube, Kit, Holo, neonLight, placed, collide, shopfront } from './cyberpunk';


/** A floor uplight: a can in the ground, throwing light up a wall. */
export function uplight(kit: Kit, p: PropConfig) {
  const color = p.color ?? '#bfe9ff';
  const g = placed(p, (p.y ?? 0));
  const { steelDark } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.1, 12), steelDark, 0, 0.05, 0));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), flat(color)).rotateX(-Math.PI / 2).translateY(0.101));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0.3, 0);
  glow.scale.setScalar(1.6);
  g.add(glow);
  kit.group.add(g);
  if (p.light) neonLight(kit, g, 0, 0.6, 0, color, 2.4);
}


/** A soft glow around a point (a tube's halo), without a real light. */
export function halo(parent: THREE.Object3D, x: number, y: number, z: number, color: string, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.5 }));
  s.material.userData.outlineParameters = { visible: false };
  s.position.set(x, y, z);
  s.scale.setScalar(size);
  parent.add(s);
}

export function streakTexture(): THREE.CanvasTexture {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  // Ripples across it, so it reads as a puddle rather than a painted stripe.
  const rand = seeded(13);
  for (let i = 0; i < 26; i++) {
    g.clearRect(0, Math.floor(rand() * 256), 64, 1 + Math.floor(rand() * 3));
  }
  return (streakTex = new THREE.CanvasTexture(c));
}


/** The puddle of light under a sign at (x, z) facing `rotY`, `w` wide and running `len` out. */
export function floorGlow(kit: Kit, x: number, z: number, rotY: number, w: number, len: number, color: string, opacity: number) {
  const g = new THREE.Group();
  g.position.set(x, 0.018, z);
  g.rotation.y = rotY;
  const mat = new THREE.MeshBasicMaterial({ map: streakTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
  p.rotation.x = -Math.PI / 2;
  p.position.z = len / 2;
  g.add(p);
  kit.group.add(g);
}


/** A ceiling light panel, with its glow. */
export function ceilingPanel(kit: Kit, x: number, z: number, lit: boolean) {
  const H = kit.height;
  const color = '#dff4ff';
  kit.group.add(mesh(box(3.0, 0.1, 1.2), kit.mats.neon(color), x, H - 0.28, z, false));
  kit.group.add(mesh(box(3.3, 0.16, 1.5), kit.mats.steelDark, x, H - 0.19, z, false));
  halo(kit.group, x, H - 0.45, z, color, 7);
  if (lit) neonLight(kit, kit.group, x, H - 1.2, z, color, 6);
}


/** A wall's dressing: vertical conduits and vents between the shopfronts and the boards. */
export function wallDetail(kit: Kit, side: -1 | 1, b: MapPlan['bounds'], H: number) {
  const x = side * (b.maxX - 0.16);
  const { steelDark, steel } = kit.mats;
  // The spots along each wall that are free of a board (z -20 and 14) and a shopfront (z -24.5,
  // -12, 2 and 18.5, about 1.5 m either way).
  for (const z of [-15.5, -8, 6.5, 24]) {
    // A pair of conduits running up to the cable tray, with a box at the foot.
    for (const [dx, r] of [
      [-0.12, 0.07],
      [0.12, 0.05],
    ] as const) {
      kit.still.add(mesh(new THREE.CylinderGeometry(r, r, H - 1.8, 8), steel, x, (H - 1.8) / 2, z + dx, false));
    }
    kit.still.add(mesh(box(0.44, 0.5, 0.44), steelDark, x, 0.25, z, false));
    kit.still.add(mesh(box(0.07, H - 1.8, 0.3), steelDark, x - side * 0.06, (H - 1.8) / 2, z, false));
    // A vent at head height, its slats.
    kit.still.add(mesh(box(0.2, 0.5, 0.9), steelDark, x, 2.0, z, false));
    for (let i = 0; i < 4; i++) kit.still.add(mesh(box(0.04, 0.06, 0.8), steel, x - side * 0.1, 1.82 + i * 0.12, z, false));
  }
}


// ---- The shell ------------------------------------------------------------------------------------

/** The steel truss over the plaza at (x, z), and the LED batten hanging under it. */
export function truss(kit: Kit, z: number, W: number, H: number, led: THREE.Material) {
  const { steel, steelDark } = kit.mats;
  const t = new THREE.Group();
  const w = W + 2 * WALL;
  t.add(mesh(box(w, 0.5, 0.4), steelDark, 0, H - 0.25, 0, false));
  t.add(mesh(box(w, 0.3, 0.28), steel, 0, H - 1.5, 0, false));
  // Zig-zag webs between the two chords.
  for (let x = -w / 2 + 1; x < w / 2 - 0.5; x += 2) {
    const web = mesh(box(2.1, 0.14, 0.14), steel, x + 0.5, H - 0.9, 0, false);
    web.rotation.z = (Math.round(x) % 4 === 0 ? 1 : -1) * 0.62;
    t.add(web);
  }
  t.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, w - 1, 6).rotateZ(Math.PI / 2), led, 0, H - 1.75, 0, false));
  t.position.set((kit.bounds.minX + kit.bounds.maxX) / 2, 0, z);
  kit.still.add(t);
}


/** A hanging bundle of cables, from (x0, y0, z0) to (x1, y1, z1), sagging. */
export function cable(kit: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number) {
  const a = new THREE.Vector3(ax, ay, az);
  const b = new THREE.Vector3(bx, by, bz);
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const mat = toon('#101218');
  kit.still.add(mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5), mat, 0, 0, 0, false));
}


/**
 * The plaza's shell: the wet floor and its glowing lines, concrete walls with windows onto the city,
 * a glazed south end with the way out, a steel ceiling of trusses and cables, the gantry down the
 * arcade, and the city itself beyond the glass — towers, a skyline, and rain.
 */
export function buildShell(kit: Kit, plan: MapPlan, pal: { floor: string; stone: string; trim: string }): { doorAt: THREE.Vector3; out: Pt; gate: THREE.Mesh } {
  const b = plan.bounds;
  const H = plan.height;
  const W = b.maxX - b.minX;
  const L = b.maxZ - b.minZ;
  const { group, still, mats } = kit;

  // The floor: wet asphalt with two guide lines down the concourse and stripes at the dais end.
  const floorTex = canvasTexture(512, 512, asphalt(pal.floor), [W / 4, L / 4]);
  const floor = mesh(new THREE.PlaneGeometry(W, L), toonMap(floorTex), 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);
  kit.colliders.push({ minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1, top: 0 });
  for (const sx of [-1, 1]) group.add(new THREE.Mesh(new THREE.PlaneGeometry(0.12, L - 2), flat(sx < 0 ? '#ff2c9c' : '#2de2e6', 0.5)).rotateX(-Math.PI / 2).translateX(sx * 2.2).translateY(0.012));
  for (let i = 0; i < 7; i++) group.add(new THREE.Mesh(new THREE.PlaneGeometry(14 - i * 1.6, 0.1), flat('#ffd60a', 0.25)).rotateX(-Math.PI / 2).translateY(0.012).translateZ(b.minZ + 3 + i * 1.1));

  // Walls west, east and north: concrete panels with bands of windows onto the city.
  const T = WALL;
  const wallTex = (along: number) => toonMap(canvasTexture(512, 384, panels(pal.stone, 5), [along / 4, H / 3]));
  const walls: [side: 'west' | 'east' | 'north', x: number, z: number, w: number, d: number][] = [
    ['west', b.minX - T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['east', b.maxX + T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['north', (b.minX + b.maxX) / 2, b.minZ - T / 2, W + 2 * T, T],
  ];
  for (const [side, x, z, w, d] of walls) {
    group.add(mesh(box(w, H, d), wallTex(side === 'north' ? W : L), x, H / 2, z));
    kit.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
    const along = side === 'north' ? 'x' : 'z';
    const len = side === 'north' ? W : L;
    for (let u = -len / 2 + 4; u <= len / 2 - 4; u += 6) {
      // A band of windows, high on the wall, with a lit tower face behind the glass.
      const wy = 6.2;
      const win = new THREE.Group();
      win.position.set(along === 'x' ? x + u : x + (side === 'west' ? 0.02 : -0.02), wy, along === 'z' ? z + u : z + 0.02);
      win.rotation.y = along === 'x' ? 0 : side === 'west' ? Math.PI / 2 : -Math.PI / 2;
      const t = towerFace('#151222', Math.round(u * 7) + 40);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(3.4 / 8, 1.7 / 8);
      win.add(mesh(new THREE.PlaneGeometry(3.4, 1.7), flatMap(t), 0, 0, -0.08, false));
      win.add(mesh(new THREE.PlaneGeometry(3.4, 1.7), GLASS, 0, 0, -0.02, false));
      win.add(mesh(box(3.6, 0.12, 0.24), mats.steelDark, 0, 0.9, 0.04, false));
      win.add(mesh(box(3.6, 0.12, 0.24), mats.steelDark, 0, -0.9, 0.04, false));
      win.add(mesh(box(0.12, 1.9, 0.24), mats.steelDark, -1.74, 0, 0.04, false));
      win.add(mesh(box(0.12, 1.9, 0.24), mats.steelDark, 1.74, 0, 0.04, false));
      group.add(win);
    }
  }
  // A cable tray and a neon cove along each side wall, and the pipes and vents on it.
  for (const sx of [-1, 1] as const) {
    still.add(mesh(box(0.3, 0.16, L - 1), mats.steelDark, sx * (W / 2 - 0.5), H - 1.2, 0, false));
    still.add(mesh(box(0.12, 0.06, L - 1), kit.mats.neon('#2de2e6'), sx * (W / 2 - 0.42), H - 1.34, 0, false));
    for (let z = b.minZ + 8; z < b.maxZ - 6; z += 16) halo(group, sx * (W / 2 - 0.6), H - 1.4, z, '#2de2e6', 5);
    wallDetail(kit, sx, b, H);
  }

  // The south end: a glazed curtain wall, with the doorway in the middle and the city beyond.
  const southZ = b.maxZ + T / 2;
  const doorL = -DOORWAY.width / 2;
  const doorR = DOORWAY.width / 2;
  const spans: [number, number][] = [
    [b.minX - T, doorL],
    [doorR, b.maxX + T],
  ];
  for (const [a, c] of spans) {
    group.add(mesh(box(c - a, 0.45, T), mats.steelDark, (a + c) / 2, 0.22, southZ));
    group.add(mesh(box(c - a, 0.03, T - 0.2), mats.steel, (a + c) / 2, 0.45, southZ, false));
    for (let x = a; x < c - 0.4; x += 3) {
      const mull = Math.min(0.16, c - x);
      group.add(mesh(box(0.16, DOORWAY.height, 0.18), mats.steelDark, x + 0.08, DOORWAY.height / 2, southZ, false));
      const glassW = Math.min(3 - 0.16, c - x - 0.16);
      if (glassW > 0.2) {
        const glass = mesh(new THREE.PlaneGeometry(glassW, DOORWAY.height - 0.5), GLASS, x + 0.16 + glassW / 2, 0.45 + (DOORWAY.height - 0.5) / 2, southZ + 0.02, false);
        group.add(glass);
      }
    }
    kit.colliders.push({ minX: a, maxX: c, minZ: southZ - T / 2, maxZ: southZ + T / 2, top: 99 });
  }
  // Above the way in and out: a beam, its sign, and a light curtain across it.
  group.add(mesh(box(DOORWAY.width + 1, H - DOORWAY.height, T), mats.steelDark, 0, (H + DOORWAY.height) / 2, southZ));
  const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOORWAY.width + 0.6, 0.7), flatMap(billboard(99)));
  lintel.position.set(0, DOORWAY.height + 0.45, southZ - 0.35);
  lintel.rotation.y = Math.PI;
  group.add(lintel);
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(DOORWAY.width - 0.2, DOORWAY.height), flat(pal.trim, 0.1));
  gate.position.set(0, DOORWAY.height / 2, southZ);
  group.add(gate);
  // The threshold and the landing.
  still.add(mesh(box(DOORWAY.width + 0.4, 0.06, 0.6), mats.steel, 0, 0.03, southZ + T / 2, false));

  // The ceiling: panels, trusses, hanging cables.
  const ceilTex = canvasTexture(256, 256, panels(shade(pal.stone, -0.14), 9), [W / 4, L / 4]);
  const ceil = mesh(new THREE.PlaneGeometry(W + 2 * T, L + 2 * T), toonMap(ceilTex), 0, H, 0, false);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, 0);
  group.add(ceil);
  const led = kit.mats.neon('#bfe9ff');
  for (let z = b.minZ + 4; z <= b.maxZ - 3; z += 8) truss(kit, z, W, H, led);
  for (const sx of [-1, 1]) for (let z = b.minZ + 6; z <= b.maxZ - 4; z += 12) {
    cable(kit, sx * (W / 2 - 0.4), H - 1.3, z, sx * 8, H - 3.4, z + 3, 0.8);
    cable(kit, sx * (W / 2 - 0.4), H - 1.3, z + 3, sx * 8, H - 3.4, z + 5, 0.6);
  }
  // Light panels in the ceiling between the trusses: the plaza's own lighting, a few of them real.
  let lit = 0;
  for (let z = b.minZ + 8; z <= b.maxZ - 4; z += 8) {
    for (const x of [-8, 0, 8]) {
      const on = (Math.round((z - b.minZ) / 8) + (x > 0 ? 1 : x < 0 ? 2 : 0)) % 3 === 0 && lit < 5;
      if (on) lit++;
      ceilingPanel(kit, x, z, on);
    }
  }

  // The gantry: over every row of columns, an I-beam with a neon batten and cables across.
  const pillarXs = [...new Set(kit.pillars.map((q) => Math.round(q.x * 10) / 10))];
  for (const px of pillarXs) {
    const zs = kit.pillars.filter((q) => Math.round(q.x * 10) / 10 === px).map((q) => q.z);
    if (zs.length < 2) continue;
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    still.add(mesh(box(0.5, 0.7, z1 - z0), mats.steel, px, 5.1, (z0 + z1) / 2, false));
    still.add(mesh(box(1.1, 0.12, z1 - z0), mats.steelDark, px, 5.62, (z0 + z1) / 2, false));
    still.add(mesh(box(1.1, 0.12, z1 - z0), mats.steelDark, px, 4.62, (z0 + z1) / 2, false));
    still.add(mesh(box(0.1, 0.1, z1 - z0 - 0.6), kit.mats.neon('#ff2c9c'), px, 4.8, (z0 + z1) / 2, false));
    for (let za = z0 + 2; za < z1; za += 4) cable(kit, px + 0.2, H - 1.2, za, px + 0.2, 5.3, za + 1.5, 1.4);
  }

  // The city, beyond the glass: the skyline on a cylinder, towers close in, floating ads, and rain.
  const sky = canvasTexture(2048, 512, skyline());
  sky.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 70, 40, 1, true), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, toneMapped: false }));
  ring.position.set(0, 14, 0);
  group.add(ring);
  const towers = new THREE.Group();
  const rand = seeded(5);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.16;
    const r = 34 + rand() * 60;
    const tw = 9 + rand() * 16;
    const th = 30 + rand() * 78;
    const t = towerFace('#1a1626', i * 3 + 1);
    t.repeat.set(tw / 8, th / 8);
    const tower = mesh(box(tw, th, tw), new THREE.MeshToonMaterial({ color: '#ffffff', map: t, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), Math.sin(a) * r, th / 2 - 22, Math.cos(a) * r, false);
    towers.add(tower);
    // A neon band or two up its face.
    const cols = ['#ff2c9c', '#2de2e6', '#ffd60a', '#39ff88'];
    for (let k = 0; k < 3; k++) {
      const band = mesh(box(tw * 0.92, 0.5, tw * 0.08), flat(cols[Math.floor(rand() * cols.length)], 0.95), Math.sin(a) * r, -12 + rand() * (th - 8), Math.cos(a) * r + tw * 0.5, false);
      band.lookAt(0, band.position.y, 0);
      towers.add(band);
    }
    // A holo sign near the top.
    if (rand() < 0.8) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(tw * 0.9, tw * 0.6), flatMap(billboard(Math.floor(rand() * 90) + 1)));
      sign.position.set(Math.sin(a) * (r + 0.1), th - 25 - 3, Math.cos(a) * (r + 0.1));
      sign.lookAt(0, sign.position.y, 0);
      towers.add(sign);
    }
  }
  // Holo ads floating over the street, and a monorail line across the sky.
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const r = 26 + rand() * 46;
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(8 + rand() * 8, 4 + rand() * 4), flatMap(billboard(200 + i)));
    ad.position.set(Math.sin(a) * r, 16 + rand() * 26, Math.cos(a) * r);
    ad.lookAt(0, ad.position.y, 0);
    towers.add(ad);
    halo(towers, ad.position.x, ad.position.y, ad.position.z, '#7fd4ff', 16);
  }
  group.add(towers);
  const railY = 30;
  const monorail = mesh(box(2.6, 0.7, 2.6), kit.mats.steelDark, 0, railY, 0, false);
  monorail.scale.set(70, 1, 0.5);
  monorail.rotation.y = 0.5;
  group.add(monorail);
  tube(group, -70, railY, 30, 60, railY, 5, 0.12, flat('#9fe8ff', 0.8));
  // Rain over the city (and the terrace): streaks falling, only ever seen through the glass.
  const rainN = 900;
  const rainPos = new Float32Array(rainN * 6);
  const rainSeed = seeded(31);
  const homes: number[][] = [];
  for (let i = 0; i < rainN; i++) {
    const a = rainSeed() * Math.PI * 2;
    const r = 20 + rainSeed() * 90;
    homes.push([Math.sin(a) * r, -6 + rainSeed() * 40, Math.cos(a) * r, 0.5 + rainSeed() * 0.5]);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#9fd4ff', transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  rain.frustumCulled = false;
  group.add(rain);
  kit.rain = { lines: rain, pos: rainPos, homes, n: rainN };

  // The terrace outside the doors: a wet deck with a railing, a noodle stand and planters.
  const deckZ0 = b.maxZ + T;
  const deckZ1 = deckZ0 + 9;
  const deck = mesh(box(24, 0.3, deckZ1 - deckZ0), mats.steelDark, 0, -0.15, (deckZ0 + deckZ1) / 2);
  group.add(deck);
  kit.colliders.push({ minX: -12, maxX: 12, minZ: deckZ0, maxZ: deckZ1, top: 0 });
  const puddle = (x: number, z: number, s: number, c: string) => {
    const p = new THREE.Mesh(new THREE.CircleGeometry(s, 20), flat(c, 0.3));
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.16, z);
    group.add(p);
  };
  puddle(-4, deckZ0 + 3, 2.2, '#ff2c9c');
  puddle(3.4, deckZ0 + 5.4, 1.6, '#2de2e6');
  puddle(7.5, deckZ0 + 2.2, 1.2, '#ffd60a');
  // Its railing: posts, a top rail, and a lit edge, with the city behind and below.
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.4) + 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / (n - 1);
      const z = z0 + ((z1 - z0) * i) / (n - 1);
      group.add(mesh(box(0.1, 1.15, 0.1), mats.steelDark, x, 0.72, z, false));
    }
    tube(group, x0, 1.28, z0, x1, 1.28, z1, 0.05, mats.steel);
    tube(group, x0, 0.5, z0, x1, 0.5, z1, 0.04, kit.mats.neon('#2de2e6'));
    const [minX, maxX] = [Math.min(x0, x1) - 0.2, Math.max(x0, x1) + 0.2];
    const [minZ, maxZ] = [Math.min(z0, z1) - 0.2, Math.max(z0, z1) + 0.2];
    kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99, fence: true });
  };
  rail(-12, deckZ1, 12, deckZ1);
  rail(-12, deckZ0, -12, deckZ1);
  rail(12, deckZ0, 12, deckZ1);
  // Lights out here: lanterns on the rail's posts, and two floods over the deck.
  for (const x of [-9, -3, 3, 9]) kit.group.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), flat('#ff6b35'), x, 1.5, deckZ1 - 0.2, false));
  for (const x of [-9, -3, 3, 9]) halo(kit.group, x, 1.5, deckZ1 - 0.2, '#ff6b35', 2.6);
  for (const x of [-12, 12]) kit.group.add(mesh(box(0.3, 0.3, 0.3), kit.mats.neon('#dff4ff'), x, 3.4, deckZ0 + 0.8, false));
  neonLight(kit, kit.group, 0, 3.2, deckZ0 + 2, '#bfe9ff', 5);
  // The noodle stand, with its lanterns.
  const stand = new THREE.Group();
  stand.position.set(-7.5, 0, deckZ0 + 2.4);
  stand.rotation.y = 1.4;
  stand.add(mesh(box(3, 2.2, 1.6), mats.steelDark, 0, 1.1, 0));
  stand.add(mesh(box(3.4, 0.12, 2.2), mats.steel, 0, 2.26, 0.2, false));
  stand.add(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), flatMap(neonSign('RAMEN', '#ff6b35'))).translateY(1.6).translateZ(0.81));
  for (const sx of [-1, 1]) stand.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), flat('#ff6b35'), sx * 1.2, 1.85, 0.9, false));
  group.add(stand);
  kit.colliders.push({ minX: -9.2, maxX: -5.8, minZ: deckZ0 + 1.4, maxZ: deckZ0 + 3.4, top: 99 });
  for (const [x, z] of [
    [6.5, deckZ0 + 1.4],
    [9, deckZ0 + 3.2],
  ] as const) {
    group.add(mesh(box(0.9, 0.9, 0.9), mats.dark, x, 0.45, z));
    group.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 10), toon('#2f5d3a'), x, 1.1, z, false));
    collide(kit, x, z, 0.9, 0.9, 0, 0.9);
  }

  const doorAt = new THREE.Vector3(0, 0, b.maxZ);
  return { doorAt, out: [0, 1], gate };
}

let streakTex: THREE.CanvasTexture | null = null;
