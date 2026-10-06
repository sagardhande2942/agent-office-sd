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
import { TABLE_TOP, billboard, towerFace, hazard, box, flatMap, flat, GLASS, rod, tube, Kit, FLAME_OUTER, FLAME_INNER, FLAME_OUT, FLAME_IN, neonLight, placed, collide, paintAd, floorGlow } from './cyberpunk';


/** A holographic billboard high on a wall: a scrolling picture, its frame, and its haze. */
export function billboardProp(kit: Kit, p: PropConfig) {
  const w = p.width ?? 3.6;
  const h = p.height ?? 2.2;
  const g = placed(p);
  g.position.y = p.y ?? 6;
  const { steelDark } = kit.mats;
  g.add(mesh(box(w + 0.3, h + 0.3, 0.14), steelDark, 0, 0, 0));
  const tex = billboard(kit.screens.length * 7 + 3);
  const mat = flatMap(tex);
  mat.fog = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  face.position.z = 0.1;
  g.add(face);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7fd4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0, 0.3);
  glow.scale.set(w * 1.5, h * 1.9, 1);
  g.add(glow);
  kit.group.add(g);
  kit.screens.push({ tex, speed: 0.012 + (kit.screens.length % 3) * 0.006, base: mat });
  floorGlow(kit, p.x, p.z, p.rotY ?? 0, w * 1.1, 7, '#7fd4ff', 0.3);
  if (p.light) neonLight(kit, g, 0, 0, 1.2, '#7fd4ff', 3);
}


/** A hologram projector: a plinth, a lens, and a shape of light turning over it. */
export function hologram(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const color = p.color ?? '#2de2e6';
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.34 * s, 0.44 * s, 0.16 * s, 12), steelDark, 0, 0.08 * s, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1 * s, 0.16 * s, 0.7 * s, 10), steel, 0, 0.5 * s, 0));
  const lens = mesh(new THREE.CylinderGeometry(0.2 * s, 0.24 * s, 0.1 * s, 12), kit.mats.neon(color), 0, 0.9 * s, 0, false);
  g.add(lens);
  // The hologram: a wireframe-ish shape of bright edges over a faint cone of light.
  const shape = new THREE.Group();
  shape.position.y = 1.7 * s;
  const edge = flat(color, 0.95);
  shape.add(new THREE.Mesh(new THREE.TorusGeometry(0.4 * s, 0.02 * s, 6, 24), edge));
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.22 * s, 0.018 * s, 6, 18), edge);
  inner.rotation.x = Math.PI / 2.4;
  shape.add(inner);
  shape.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 * s, 0), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85, toneMapped: false })));
  const cone = mesh(new THREE.ConeGeometry(0.46 * s, 1.6 * s, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), 0, 1.7 * s, 0, false);
  cone.rotation.x = Math.PI;
  g.add(cone);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 1.7 * s, 0);
  glow.scale.setScalar(2.4 * s);
  g.add(glow, shape);
  kit.group.add(g);
  kit.holos.push({ group: g, core: shape, cone, glow, color: new THREE.Color(color), phase: Math.random() * 7, baseY: 1.7 * s });
  neonLight(kit, g, 0, 1.5 * s, 0, color, 2.2);
  collide(kit, p.x, p.z, 0.8 * s, 0.8 * s, 0, g.position.y + 0.95 * s);
}


/** A vending machine: E for a drink, like the office's coffee. */
export function vending(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, dark } = kit.mats;
  const W = PROP_SIZE.machine.width * s;
  const D = PROP_SIZE.machine.depth * s;
  const H = 1.9 * s;
  g.add(mesh(box(W, H, D), steelDark, 0, H / 2, 0));
  // Its glowing front: a panel of bottles, a slot, and a lit strip.
  const panel = mesh(box(W - 0.16, H - 0.5, 0.04), flat(shade(color, -0.35), 0.85), 0, H / 2 + 0.1, D / 2 + 0.01, false);
  g.add(panel);
  const bottle = toon('#8ecae6');
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3; i++) {
      g.add(mesh(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 0.18 * s, 8), bottle, (-0.24 + i * 0.24) * s, (1.15 + r * 0.32) * s, D / 2 + 0.04, false));
    }
  }
  g.add(mesh(box(W - 0.2, 0.1 * s, 0.06), kit.mats.neon(color), 0, 0.72 * s, D / 2 + 0.03, false));
  g.add(mesh(box(0.26 * s, 0.12 * s, 0.05), dark, 0, 0.5 * s, D / 2 + 0.04, false));
  const label = textPlane('⚡ Drinks', { bg: '#0a0c12', color: '#ffffff', size: 44 });
  label.scale.multiplyScalar(0.42);
  label.position.set(0, H - 0.16 * s, D / 2 + 0.05);
  g.add(label);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, W, D, r, g.position.y + H);
  const it: Interactable = { kind: 'coffee', label: '🥤 Vending machine', x: p.x + Math.sin(r) * 1.0, y: g.position.y, z: p.z + Math.cos(r) * 1.0, radius: 1.5 };
  g.userData.interact = it;
  return it;
}


/** Stacked cases and a pallet. */
export function cases(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { dark, darkAlt, steel } = kit.mats;
  g.add(mesh(box(1.0 * s, 0.7 * s, 0.9 * s), dark, 0, 0.35 * s, 0));
  g.add(mesh(box(0.8 * s, 0.55 * s, 0.7 * s), darkAlt, -0.08 * s, 0.97 * s, 0.06 * s));
  g.add(mesh(box(0.9 * s, 0.08 * s, 0.1 * s), steel, 0, 0.5 * s, 0.46 * s, false));
  for (const sx of [-1, 1]) g.add(mesh(box(0.1 * s, 0.7 * s, 0.9 * s), steel, sx * 0.5 * s, 0.35 * s, 0, false));
  kit.still.add(g);
  collide(kit, p.x, p.z, 1.1 * s, 1.0 * s, p.rotY ?? 0, g.position.y + 1.3 * s);
}


/** A steel grate breathing steam: in the floor, or in a wall at `y`. */
export function grate(kit: Kit, p: PropConfig) {
  const g = placed(p);
  const { steelDark, steel } = kit.mats;
  const onWall = p.y !== undefined;
  g.position.y = p.y ?? 0;
  g.add(mesh(box(1.2, onWall ? 0.9 : 0.06, onWall ? 0.06 : 1.2), steelDark, 0, onWall ? 0 : 0.03, 0));
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * 0.95;
    g.add(mesh(onWall ? box(0.06, 0.05, 0.9) : box(0.9, 0.04, 0.06), steel, onWall ? 0 : t, onWall ? t : 0.07, onWall ? t : 0, false));
  }
  kit.still.add(g);
  kit.steam?.add(p.x, g.position.y + 0.1, p.z);
}


/** A plasteel barrier, lit along its top. */
export function barrier(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = (p.width ?? PROP_SIZE.barrier.width) * s;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark } = kit.mats;
  const h = 0.95 * s;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.7), flatMap(hazard(color)));
  face.position.set(0, h * 0.45, 0.09 * s);
  g.add(face);
  const back = face.clone();
  back.position.z = -0.09 * s;
  back.rotation.y = Math.PI;
  g.add(back);
  g.add(mesh(box(w, 0.08 * s, 0.3 * s), steelDark, 0, h, 0));
  g.add(mesh(box(w, 0.08 * s, 0.3 * s), steelDark, 0, h * 0.12, 0));
  for (const sx of [-1, 1]) g.add(mesh(box(0.14 * s, h, 0.24 * s), steelDark, sx * (w / 2 - 0.1 * s), h / 2, 0));
  tube(g, -w / 2, h + 0.06 * s, 0, w / 2, h + 0.06 * s, 0, 0.025, kit.mats.neon(color));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, 0.4 * s, p.rotY ?? 0, g.position.y + h);
}


/** A tube light on a wall, in a cage, burning toward `rotY`. */
export function wallLamp(kit: Kit, p: PropConfig) {
  const color = p.color ?? '#bfe9ff';
  const g = placed(p);
  const { steelDark, steel } = kit.mats;
  g.add(mesh(box(0.16, 0.34, 0.16), steelDark, 0, 0, -0.2));
  g.add(mesh(box(0.1, 0.1, 0.34), steel, 0, 0, -0.04));
  const tubeMat = kit.mats.neon(color);
  const tubeMesh = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), tubeMat, 0, 0, 0.18, false);
  tubeMesh.rotation.x = Math.PI / 2;
  g.add(tubeMesh);
  for (const sx of [-1, 1]) g.add(mesh(box(0.02, 0.16, 0.7), steel, sx * 0.07, 0, 0.18, false));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0, 0.3);
  glow.scale.setScalar(2.4);
  g.add(glow);
  kit.group.add(g);
  if (p.light) neonLight(kit, g, 0, 0, 0.5, color, 3.2);
}


/** A fire in an oil drum. */
export function fireDrum(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.38 * s, 0.38 * s, 0.95 * s, 14), steelDark, 0, 0.48 * s, 0));
  for (const y of [0.28, 0.72]) g.add(mesh(new THREE.TorusGeometry(0.39 * s, 0.03, 6, 18).rotateX(Math.PI / 2), steel, 0, y * s, 0, false));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hole = mesh(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.06, 6), flat('#ff8c2a'), Math.cos(a) * 0.38 * s, 0.55 * s, Math.sin(a) * 0.38 * s, false);
    hole.rotation.z = Math.PI / 2;
    hole.rotation.y = -a;
    g.add(hole);
  }
  const f = new THREE.Group();
  f.position.y = 0.95 * s;
  f.add(new THREE.Mesh(FLAME_OUTER, FLAME_OUT));
  const inner = new THREE.Mesh(FLAME_INNER, FLAME_IN);
  inner.position.y = 0.02;
  f.add(inner);
  f.scale.setScalar(s);
  g.add(f);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb45a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 1.25 * s, 0);
  glow.scale.setScalar(5 * s);
  g.add(glow);
  kit.group.add(g);
  kit.flames.push({ group: f, glow, size: s, phase: Math.random() * 9 });
  if (p.light) neonLight(kit, g, 0, 1.4 * s, 0, '#ff8c2a', 3.6);
  collide(kit, p.x, p.z, 0.9 * s, 0.9 * s, 0, g.position.y + 0.95 * s);
}


/** A ring of LED tubes hanging from the ceiling at `y`. */
export function ringLight(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const color = p.color ?? '#bfe9ff';
  const y = p.y ?? kit.height - 2.4;
  const g = placed(p);
  g.position.y = y;
  const r = 1.1 * s;
  g.add(mesh(new THREE.TorusGeometry(r, 0.05, 6, 30).rotateX(Math.PI / 2), kit.mats.steelDark, 0, 0, 0, false));
  const led = kit.mats.neon(color);
  g.add(mesh(new THREE.TorusGeometry(r - 0.1, 0.035, 6, 30).rotateX(Math.PI / 2), led, 0, -0.06, 0, false));
  g.add(mesh(new THREE.TorusGeometry(r - 0.34, 0.035, 6, 30).rotateX(Math.PI / 2), led, 0, -0.06, 0, false));
  for (const sx of [-1, 1]) tube(g, sx * r, 0, 0, sx * r, kit.height - y, 0, 0.012, kit.mats.steelDark);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, -0.2, 0);
  glow.scale.setScalar(5 * s);
  g.add(glow);
  kit.group.add(g);
  if (p.light) neonLight(kit, g, 0, -0.3, 0, color, 4);
}


/** A hanging ad board in the floor's color, with the project's name on the great one. */
export function adBoard(kit: Kit, p: PropConfig) {
  const w = p.width ?? 2.4;
  const h = p.height ?? 3.4;
  const y = p.y ?? 8;
  const g = placed(p);
  g.position.y = y;
  const { steelDark } = kit.mats;
  g.add(mesh(box(w + 0.2, h + 0.2, 0.08), steelDark, 0, -h / 2, 0));
  const tex = canvasTexture(384, 512, (c) => paintAd(c, 384, 512, kit.ledColor));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flatMap(tex));
  face.position.set(0, -h / 2, 0.055);
  g.add(face);
  const back = face.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.055;
  g.add(back);
  const rod = mesh(box(w + 0.3, 0.08, 0.08), steelDark, 0, 0, 0);
  g.add(rod);
  kit.group.add(g);
  kit.banners.push({ tex, w: 384, h: 512, great: w >= 3 });
}


/** A window in a wall, with the city's lights behind it. */
export function cityWindow(kit: Kit, p: PropConfig) {
  const w = p.width ?? 2.3;
  const h = p.height ?? 2.6;
  const y = p.y ?? 2.2;
  const g = placed(p);
  g.position.y = y;
  const { steelDark } = kit.mats;
  g.add(mesh(box(w + 0.3, h + 0.3, 0.12), steelDark, 0, h / 2, 0));
  const tex = towerFace('#151222', Math.round((p.x + p.z) * 13) + 5);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 6, h / 6);
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), flatMap(tex)).translateZ(0.07));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), GLASS).translateZ(0.1));
  tube(g, -w / 2, 0, 0.12, -w / 2, h, 0.12, 0.025, kit.mats.neon('#2de2e6'));
  tube(g, w / 2, 0, 0.12, w / 2, h, 0.12, 0.025, kit.mats.neon('#2de2e6'));
  kit.group.add(g);
}


/** A round holographic porthole, at `y`. */
export function porthole(kit: Kit, p: PropConfig) {
  const s = p.width ?? 3;
  const y = p.y ?? 5;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p);
  g.position.y = y;
  g.add(mesh(new THREE.TorusGeometry(s / 2, 0.1, 8, 28), kit.mats.steelDark, 0, 0, 0, false));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(s / 2 - 0.08, 28), flat(shade(color, -0.35), 0.9)).translateZ(0.04));
  for (let i = 0; i < 3; i++) g.add(new THREE.Mesh(new THREE.TorusGeometry((s / 2 - 0.25) * (1 - i * 0.28), 0.03, 6, 26), kit.mats.neon(color)).translateZ(0.08 + i * 0.01));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0, 0.2);
  glow.scale.setScalar(s * 1.6);
  g.add(glow);
  kit.group.add(g);
}


/** A glowing guide strip on the floor, `width` by `length` along `rotY`. */
export function floorStrip(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 8;
  const color = p.color ?? kit.ledColor;
  const g = placed(p, (p.y ?? 0) + 0.02);
  const strip = mesh(new THREE.PlaneGeometry(w, l), flat(color, 0.55), 0, 0, 0, false);
  strip.rotation.x = -Math.PI / 2;
  g.add(strip);
  for (const sx of [-1, 1]) {
    const edge = mesh(new THREE.PlaneGeometry(0.08, l), flat(color, 0.95), (sx * w) / 2, 0.005, 0, false);
    edge.rotation.x = -Math.PI / 2;
    g.add(edge);
  }
  kit.group.add(g);
}


/** A chrome figure on a plinth: the corporation's mascot. */
export function chromeStatue(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel, gold } = kit.mats;
  g.add(mesh(box(0.9 * s, 0.5 * s, 0.9 * s), steelDark, 0, 0.25 * s, 0));
  g.add(mesh(box(0.7 * s, 0.16 * s, 0.7 * s), gold, 0, 0.56 * s, 0, false));
  // A polished diamond, the way a corpo lobby has one.
  const gem = mesh(new THREE.OctahedronGeometry(0.5 * s, 0), steel, 0, 1.35 * s, 0);
  gem.scale.y = 1.5;
  g.add(gem);
  tube(g, -0.5 * s, 0.62 * s, 0.5 * s, 0.5 * s, 0.62 * s, 0.5 * s, 0.02, kit.mats.neon('#2de2e6'));
  tube(g, -0.5 * s, 0.62 * s, -0.5 * s, 0.5 * s, 0.62 * s, -0.5 * s, 0.02, kit.mats.neon('#2de2e6'));
  kit.still.add(g);
  collide(kit, p.x, p.z, 1.0 * s, 1.0 * s, p.rotY ?? 0, g.position.y + 1.9 * s);
}


/** A security drone on a charging stand. */
export function sentry(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  const color = p.color ?? '#ff2c9c';
  g.add(mesh(new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 1.1 * s, 8), steelDark, 0, 0.55 * s, 0));
  const body = new THREE.Group();
  body.position.y = 1.3 * s;
  body.add(mesh(new THREE.SphereGeometry(0.34 * s, 16, 12), steel, 0, 0, 0));
  body.add(mesh(new THREE.SphereGeometry(0.16 * s, 12, 8), flat(color), 0, 0.02 * s, 0.28 * s, false));
  for (const sx of [-1, 1]) {
    const wing = mesh(box(0.5 * s, 0.05 * s, 0.2 * s), steelDark, sx * 0.45 * s, 0.1 * s, 0, false);
    wing.rotation.z = sx * 0.25;
    body.add(wing);
  }
  g.add(body);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 1.32 * s, 0.3 * s);
  glow.scale.setScalar(1.4 * s);
  g.add(glow);
  kit.group.add(g);
  collide(kit, p.x, p.z, 0.7 * s, 0.7 * s, 0, g.position.y + 1.7 * s);
}


/** A hanging plaque with the corporation's crest on it. */
export function plaque(kit: Kit, p: PropConfig) {
  const w = p.width ?? 0.9;
  const y = p.y ?? 3;
  const color = p.color ?? '#ffd60a';
  const g = placed(p);
  g.position.y = y;
  const { steelDark, gold } = kit.mats;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, -w * 0.7);
  shape.lineTo(0, -w * 1.05);
  shape.lineTo(-w / 2, -w * 0.7);
  shape.closePath();
  g.add(mesh(new THREE.ShapeGeometry(shape), gold, 0, 0, 0, false));
  g.add(mesh(new THREE.TorusGeometry(w * 0.22, 0.03, 6, 18), steelDark, 0, -w * 0.45, 0.02, false));
  tube(g, -w / 2, 0, 0.03, 0, -w * 1.05, 0.03, 0.02, kit.mats.neon(color));
  tube(g, w / 2, 0, 0.03, 0, -w * 1.05, 0.03, 0.02, kit.mats.neon(color));
  kit.group.add(g);
}


/** A backlit wall of screens: the bar's video wall. */
export function videoWall(kit: Kit, p: PropConfig) {
  const w = p.width ?? PROP_SIZE.hearth.width;
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark } = kit.mats;
  const h = 2.4 * s;
  g.add(mesh(box(w, h, 0.4 * s), steelDark, 0, h / 2, 0));
  const tex = billboard(kit.screens.length * 7 + 11);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 0.4), flatMap(tex));
  face.position.set(0, h / 2, 0.21 * s);
  g.add(face);
  kit.screens.push({ tex, speed: 0.02, base: face.material as THREE.MeshBasicMaterial });
  tube(g, -w / 2, h - 0.1, 0.22 * s, w / 2, h - 0.1, 0.22 * s, 0.03, kit.mats.neon(p.color ?? '#2de2e6'));
  kit.group.add(g);
  collide(kit, p.x, p.z, w, 0.4 * s, p.rotY ?? 0, g.position.y + h);
  if (p.light) neonLight(kit, g, 0, 1.6, 0.8, p.color ?? '#2de2e6', 5);
}


/** A small fridge of drinks: E for a can, like the office's coffee. */
export function drinksFridge(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  const color = p.color ?? '#39ff88';
  g.add(mesh(box(0.9 * s, 1.6 * s, 0.7 * s), steelDark, 0, 0.8 * s, 0));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.6 * s, 1.1 * s), flat(color, 0.4)).translateY(0.85 * s).translateZ(0.36 * s));
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.16 * s, 8), toon('#8ecae6'), (-0.18 + i * 0.18) * s, 1.0 * s, 0.36 * s, false));
  const label = textPlane('🥤 Cold ones', { bg: '#0a0c12', color: '#ffffff', size: 44 });
  label.scale.multiplyScalar(0.38);
  label.position.set(0, 1.72 * s, 0.1);
  g.add(label);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, 0.9 * s, 0.7 * s, r, g.position.y + 1.6 * s);
  const it: Interactable = { kind: 'coffee', label: '🥤 Cold ones', x: p.x + Math.sin(r) * 0.9, y: g.position.y, z: p.z + Math.cos(r) * 0.9, radius: 1.4 };
  g.userData.interact = it;
  return it;
}


/** A steel work table with nothing to sit at. */
export function steelTable(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 3;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steel, steelDark } = kit.mats;
  g.add(mesh(roundedBox(w, 0.1, l, 0.04), steel, 0, TABLE_TOP - 0.05, 0));
  g.add(mesh(box(w - 0.2, 0.16, l - 0.4), steelDark, 0, TABLE_TOP - 0.16, 0, false));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) g.add(mesh(box(0.08, TABLE_TOP - 0.1, 0.08), steelDark, sx * (w / 2 - 0.1), (TABLE_TOP - 0.1) / 2, sz * (l / 2 - 0.2)));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, l, p.rotY ?? 0, g.position.y + TABLE_TOP);
}
