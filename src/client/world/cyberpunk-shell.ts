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
import { TABLE_TOP, BENCH_TOP, billboard, box, flatMap, flat, tube, Kit, collide, floorGlow, cable } from './cyberpunk';


// ---- The dais, the desks and the rest -------------------------------------------------------------

/** The chrome dais at the north end, the boss's chair on it, and the wall of light behind. */
export function buildDais(kit: Kit, plan: MapPlan): Interactable | undefined {
  const t = plan.throne;
  const dais = plan.dais;
  if (!t || !dais) return undefined;
  const { mats } = kit;
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  g.rotation.y = t.rotY;
  const front = 2.4;
  const top = dais.height;
  const at = (lx: number, lz: number) => [t.x + Math.cos(t.rotY) * lx + Math.sin(t.rotY) * lz, t.z - Math.sin(t.rotY) * lx + Math.cos(t.rotY) * lz] as const;
  // The platform, with a lit edge and steps down its front.
  g.add(mesh(box(dais.width, top, dais.depth), mats.steelDark, 0, top / 2, front - dais.depth / 2));
  g.add(mesh(box(dais.width + 0.1, 0.12, 0.12), kit.mats.neon(kit.ledColor), 0, top - 0.06, front));
  for (let k = 1; k <= dais.steps; k++) {
    const y = (top * (dais.steps + 1 - k)) / (dais.steps + 1);
    const lz = front + (k - 0.5) * 0.7;
    g.add(mesh(box(dais.width, y, 0.7), mats.steel, 0, y / 2, lz));
    g.add(mesh(box(dais.width - 0.2, 0.04, 0.04), kit.mats.neon(kit.ledColor), 0, y + 0.02, lz + 0.34, false));
  }
  const [cx, cz] = at(0, front - dais.depth / 2);
  collide(kit, cx, cz, dais.width, dais.depth, t.rotY, top);
  // The chair: a chrome frame with magenta cushions, and a gunmetal desk in front of it.
  const chair = new THREE.Group();
  chair.position.set(0, top, front - 1.15);
  chair.add(mesh(box(1.0, 0.12, 0.9), mats.steel, 0, 0.52, 0));
  chair.add(mesh(roundedBox(0.86, 0.14, 0.78, 0.05), mats.seat, 0, 0.64, 0, false));
  chair.add(mesh(box(1.0, 1.5, 0.14), mats.steel, 0, 1.3, -0.42));
  chair.add(mesh(roundedBox(0.82, 0.9, 0.1, 0.05), mats.seat, 0, 1.26, -0.31, false));
  chair.add(mesh(box(0.12, 0.5, 0.12), mats.steelDark, 0, 0.25, 0));
  chair.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.08, 16), mats.steelDark, 0, 0.05, 0));
  for (const sx of [-1, 1]) tube(chair, sx * 1.14, 0.9, -0.1, sx * 1.14, 0.9, 1.6, 0.03, kit.mats.neon('#ff2c9c'));
  g.add(chair);
  const seat: Interactable = { kind: 'seat', seatId: t.id, x: t.x, y: t.y, z: t.z, radius: 1.7 };
  chair.userData.interact = seat;
  kit.interactables.push(seat);
  // The console in front of the chair.
  g.add(mesh(box(4.2, 0.1, 0.9), mats.steel, 0, top + 0.78, front - 0.2));
  g.add(mesh(box(4.0, 0.7, 0.5), mats.steelDark, 0, top + 0.4, front - 0.2, false));
  g.add(mesh(box(4.0, 0.06, 0.06), kit.mats.neon('#2de2e6'), 0, top + 0.85, front + 0.24, false));
  // The wall of light behind: one great holo screen, framed in neon.
  const big = new THREE.Mesh(new THREE.PlaneGeometry(13, 5), flatMap(billboard(7)));
  big.position.set(t.x, 9.4, plan.bounds.minZ + 0.2);
  kit.group.add(big);
  kit.screens.push({ tex: (big.material as THREE.MeshBasicMaterial).map as THREE.CanvasTexture, speed: 0.008, base: big.material as THREE.MeshBasicMaterial });
  for (const [x0, y0, x1, y1] of [
    [-6.6, 6.9, 6.6, 6.9],
    [-6.6, 11.9, 6.6, 11.9],
    [-6.6, 6.9, -6.6, 11.9],
    [6.6, 6.9, 6.6, 11.9],
  ] as const)
    tube(kit.group, x0, y0, plan.bounds.minZ + 0.3, x1, y1, plan.bounds.minZ + 0.3, 0.05, kit.mats.neon('#ff2c9c'));
  floorGlow(kit, t.x, plan.bounds.minZ + 0.4, 0, 15, 9, '#ff2c9c', 0.22);
  kit.group.add(g);
  return seat;
}


/** The console benches the workers sit at, as the plan has them: a steel deck with an LED edge. */
export function buildTables(kit: Kit, plan: MapPlan) {
  const { mats } = kit;
  for (const t of plan.tables) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rotY;
    g.add(mesh(roundedBox(t.width, 0.1, t.length, 0.04), mats.steel, 0, TABLE_TOP - 0.05, 0));
    g.add(mesh(box(t.width - 0.3, 0.3, t.length - 0.4), mats.steelDark, 0, TABLE_TOP - 0.25, 0, false));
    const legs = Math.max(2, Math.round(t.length / 3.2) + 1);
    for (let i = 0; i < legs; i++) {
      const lz = -t.length / 2 + 0.35 + (i * (t.length - 0.7)) / (legs - 1);
      g.add(mesh(box(t.width - 0.3, TABLE_TOP - 0.1, 0.1), mats.steelDark, 0, (TABLE_TOP - 0.1) / 2, lz));
    }
    // A glowing strip under each long edge, and a cable tray.
    for (const s of t.sides) g.add(mesh(box(0.05, 0.05, t.length - 0.3), kit.mats.neon(s < 0 ? '#ff2c9c' : '#2de2e6'), (s * t.width) / 2 - s * 0.03, TABLE_TOP - 0.14, 0, false));
    // A holo-terminal between every pair of places, and a case of parts.
    for (let i = 0; i < t.seats - 1; i++) {
      const lz = (i + 1 - t.seats / 2) * (t.length / t.seats);
      g.add(mesh(box(0.5, 0.05, 0.34), mats.steelDark, 0, TABLE_TOP + 0.03, lz, false));
      g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), flat(i % 2 ? '#2de2e6' : '#ff2c9c', 0.8)).rotateX(-Math.PI / 2).translateY(TABLE_TOP + 0.06).translateZ(lz));
    }
    for (const s of t.sides) {
      const bx = s * (t.width / 2 + BENCH_OUT);
      g.add(mesh(roundedBox(0.44, 0.1, t.length - 0.2, 0.03), mats.dark, bx, BENCH_TOP - 0.05, 0, false));
      for (let i = 0; i < legs; i++) {
        const lz = -t.length / 2 + 0.4 + (i * (t.length - 0.8)) / (legs - 1);
        g.add(mesh(box(0.36, BENCH_TOP - 0.1, 0.08), mats.steelDark, bx, (BENCH_TOP - 0.1) / 2, lz));
      }
      collide(kit, t.x + Math.cos(t.rotY) * bx, t.z - Math.sin(t.rotY) * bx, 0.44, t.length - 0.2, t.rotY, BENCH_TOP);
    }
    kit.group.add(g);
    collide(kit, t.x, t.z, t.width, t.length, t.rotY, TABLE_TOP);
  }
}


/** A place at a console bench: its terminal anchor, the worker on the bench, a mug and the '+'. */
export function placeSetting(kit: Kit, def: DeskDef, overflow: boolean): { view: DeskView; it: Interactable } {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, TABLE_TOP, -0.02);
  laptopAnchor.scale.setScalar(1.1);
  g.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, BENCH_TOP - 0.08, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  const stage = new THREE.Object3D();
  stage.position.set(0.66, TABLE_TOP - 0.07, 0.12);
  g.add(stage);
  // A mug of synth-coffee, and a little fan of mem-cards.
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.14, 10), toon('#2de2e6'), -0.64, TABLE_TOP + 0.07, 0.12, false));
  g.add(mesh(box(0.16, 0.02, 0.1), toon('#ffd60a'), -0.64, TABLE_TOP + 0.01, -0.14, false));
  const vacancy = vacancyMarker(1.35);
  g.add(vacancy);
  g.visible = !overflow;
  const it: Interactable = { kind: 'desk', deskId: def.id, ...deskSeat(def, 1.25), radius: 1.3, off: overflow };
  kit.interactables.push(it);
  g.userData.interact = it;
  kit.group.add(g);
  return { view: { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 1.35 }, it };
}


/** A board agent's info kiosk: a pedestal with a glowing screen, the agent standing behind it. */
export function lectern(kit: Kit, def: DeskDef): DeskView {
  const kind = def.station!;
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const { steelDark, steel } = kit.mats;
  const color = STATION_AGENT[kind].color;
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.08, 12), steelDark, 0, 0.04, 0));
  g.add(mesh(box(0.14, 0.95, 0.14), steelDark, 0, 0.5, 0));
  const top = new THREE.Group();
  top.position.set(0, 1.0, 0);
  top.rotation.x = 0.35;
  top.add(mesh(box(KIOSK.width, 0.07, KIOSK.depth), steel, 0, 0, 0));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(KIOSK.width - 0.14, KIOSK.depth + 0.1), flat(shade(color, -0.3), 0.95));
  screen.position.set(0, 0.05, -0.05);
  screen.rotation.x = -Math.PI / 2;
  top.add(screen);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(KIOSK.width - 0.2, 0.05), flat(color, 0.9));
  scan.position.set(0, 0.06, 0);
  scan.rotation.x = -Math.PI / 2;
  top.add(scan);
  g.add(top);
  const sign = textPlane(kind === 'issues' ? '📟 Ask me' : kind === 'pulls' ? '🔀 Ask me' : '📋 Ask me', { bg: '#0a0c12', color: '#ffffff', size: 52 });
  sign.scale.multiplyScalar(0.5);
  sign.position.set(0, 0.66, -0.12);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.add(mesh(box(KIOSK.width - 0.1, 0.5, 0.02), flat(shade(color, -0.5), 0.7), 0, 0.42, -0.09, false));
  g.add(mesh(box(KIOSK.width - 0.2, 0.04, 0.04), kit.mats.neon(color), 0, 0.18, -0.11, false));
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  g.add(laptopAnchor);
  const stand = new THREE.Object3D();
  stand.position.set(0, -0.07 * 1.1, KIOSK.stand);
  stand.rotation.y = Math.PI;
  stand.scale.setScalar(1.1);
  const seatAnchor = stand.clone();
  g.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(stand);
  g.add(vacancy);
  const stage = new THREE.Object3D();
  stage.position.set(0, 1.0, 0);
  stage.rotation.y = Math.PI;
  g.add(stage);
  kit.group.add(g);
  const corners = [-1, 1].flatMap((t) => [-0.25, KIOSK.stand + 0.35].map((s) => deskPoint(def, (t * KIOSK.width) / 2, s)));
  kit.colliders.push({ minX: Math.min(...corners.map((p) => p[0])), maxX: Math.max(...corners.map((p) => p[0])), minZ: Math.min(...corners.map((p) => p[1])), maxZ: Math.max(...corners.map((p) => p[1])), top: 1.5, fence: true });
  const [fx, fz] = deskPoint(def, 0, -1);
  const it: Interactable = { kind: 'station', deskId: def.id, x: fx, z: fz, radius: 1.3 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 0 };
}


/** A chrome stool at the meeting table. */
export function councilChair(kit: Kit, def: DeskDef): DeskView {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.85);
  const { steel, steelDark, seat } = kit.mats;
  chair.add(mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 14), seat, 0, 0.5, 0, false));
  chair.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8), steel, 0, 0.26, 0));
  chair.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 12), steelDark, 0, 0.03, 0));
  chair.add(mesh(roundedBox(0.5, 0.6, 0.08, 0.04), seat, 0, 0.92, 0.2, false));
  for (const sx of [-1, 1]) chair.add(mesh(box(0.06, 0.6, 0.06), steel, sx * 0.24, 0.62, 0.2));
  g.add(chair);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, COUNCIL.height, -0.05);
  laptopAnchor.scale.setScalar(0.95);
  g.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.52, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  const stage = new THREE.Object3D();
  stage.position.set(0.45, COUNCIL.height - 0.07, -0.1);
  g.add(stage);
  const vacancy = vacancyMarker(1.45);
  g.add(vacancy);
  kit.group.add(g);
  kit.colliders.push({ minX: def.x + Math.sin(def.rotY) * 0.85 - 0.3, maxX: def.x + Math.sin(def.rotY) * 0.85 + 0.3, minZ: def.z + Math.cos(def.rotY) * 0.85 - 0.3, maxZ: def.z + Math.cos(def.rotY) * 0.85 + 0.3, top: 0.55 });
  const it: Interactable = { kind: 'desk', deskId: def.id, ...deskSeat(def, 1.5), radius: 1.1 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair, vacancy, vacancyY: 1.45 };
}


/** The round holo table, its chairs, and the stand with the meeting's board and sign. */
export function buildCouncil(kit: Kit, plan: MapPlan): { board?: THREE.Mesh; sign?: THREE.Mesh } {
  const cp = plan.council;
  if (!cp) return {};
  const { mats } = kit;
  const t = new THREE.Group();
  t.position.set(cp.x, 0, cp.z);
  t.add(mesh(new THREE.CylinderGeometry(COUNCIL.radius, COUNCIL.radius, 0.09, 32), mats.steelDark, 0, COUNCIL.height - 0.045, 0));
  t.add(mesh(new THREE.CylinderGeometry(0.24, 0.3, COUNCIL.height - 0.09, 12), mats.steel, 0, (COUNCIL.height - 0.09) / 2, 0));
  t.add(mesh(new THREE.TorusGeometry(COUNCIL.radius, 0.045, 6, 36).rotateX(Math.PI / 2), kit.mats.neon('#2de2e6'), 0, COUNCIL.height - 0.02, 0, false));
  // The projector in the middle of the table, with its holo above it.
  const holo = new THREE.Group();
  holo.position.y = COUNCIL.height;
  holo.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 12), mats.steel, 0, 0.05, 0));
  const shape = new THREE.Group();
  shape.position.y = 0.75;
  const edge = flat('#7fd4ff', 0.9);
  shape.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.016, 6, 22), edge));
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: '#7fd4ff', wireframe: true, transparent: true, opacity: 0.8, toneMapped: false }));
  shape.add(inner);
  const cone = mesh(new THREE.ConeGeometry(0.36, 1.3, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), 0, 0.7, 0, false);
  cone.rotation.x = Math.PI;
  holo.add(cone, shape);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7fd4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0.75, 0);
  glow.scale.setScalar(2.4);
  holo.add(glow);
  t.add(holo);
  kit.group.add(t);
  kit.holos.push({ group: holo, core: shape, cone, glow, color: new THREE.Color('#7fd4ff'), phase: Math.random() * 9, baseY: 0.75 });
  const r = COUNCIL.radius * Math.SQRT1_2;
  kit.colliders.push({ minX: cp.x - r, maxX: cp.x + r, minZ: cp.z - r, maxZ: cp.z + r, top: COUNCIL.height });
  const meeting: Interactable = { kind: 'meeting', x: cp.x, z: cp.z, radius: 2.2 };
  t.userData.interact = meeting;
  kit.interactables.push(meeting);
  for (const def of plan.meeting) kit.desks.set(def.id, councilChair(kit, def));
  // A holo board on a stand behind the table, away from its head.
  const stand = new THREE.Group();
  stand.position.set(cp.x - Math.sin(cp.rotY) * COUNCIL.easel, 0, cp.z - Math.cos(cp.rotY) * COUNCIL.easel);
  stand.rotation.y = cp.rotY;
  for (const sx of [-1, 1]) stand.add(mesh(box(0.1, 3.0, 0.1), mats.steelDark, sx * 1.15, 1.5, 0));
  stand.add(mesh(box(0.12, 2.6, 0.1), mats.steelDark, 0, 1.2, -0.5));
  stand.add(mesh(box(2.7, 1.7, 0.1), mats.steelDark, 0, 2.0, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  board.position.set(0, 2.0, 0.06);
  stand.add(board);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.34), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  sign.position.set(0, 0.9, 0.06);
  stand.add(mesh(box(1.3, 0.44, 0.08), mats.steelDark, 0, 0.9, 0));
  stand.add(sign);
  const title = textPlane('🤝 The war room', { bg: '#0a0c12', color: '#ffffff', size: 56 });
  title.scale.multiplyScalar(0.62);
  title.position.set(0, 3.08, 0.06);
  stand.add(title);
  tube(stand, -1.25, 2.9, 0.08, 1.25, 2.9, 0.08, 0.03, kit.mats.neon('#7fd4ff'));
  stand.userData.interact = meeting;
  kit.group.add(stand);
  const [minX, maxX, minZ, maxZ] = boxFootprint(stand.position.x, stand.position.z, 2.7, 0.6, cp.rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99 });
  return { board, sign };
}


/** The four boards, in steel frames with neon labels, on the side walls. */
export function buildBoards(kit: Kit, plan: MapPlan): Record<BoardKey, THREE.Mesh> {
  const faces = {} as Record<BoardKey, THREE.Mesh>;
  for (const k of BOARD_KEYS) {
    const bd = plan.boards[k];
    const nx = Math.sin(bd.rotY);
    const nz = Math.cos(bd.rotY);
    const g = new THREE.Group();
    g.position.set(bd.x + nx * 0.1, bd.y, bd.z + nz * 0.1);
    g.rotation.y = bd.rotY;
    g.add(mesh(box(bd.width + 0.4, bd.height + 0.4, 0.12), kit.mats.steelDark, 0, 0, 0));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(mesh(box(0.26, 0.26, 0.06), kit.mats.steel, sx * (bd.width / 2 + 0.02), sy * (bd.height / 2 + 0.02), 0.08, false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bd.width, bd.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    face.position.z = 0.07;
    g.add(face);
    faces[k] = face;
    const label = textPlane(bd.label, { bg: '#0a0c12', color: '#ffffff', size: 64, border: '#2de2e6' });
    label.scale.multiplyScalar(1.1);
    label.position.set(0, bd.height / 2 + 0.55, 0.06);
    g.add(label);
    tube(g, -bd.width / 2 - 0.2, bd.height / 2 + 0.32, 0.08, bd.width / 2 + 0.2, bd.height / 2 + 0.32, 0.08, 0.03, kit.mats.neon(k === 'pulls' ? '#ff2c9c' : k === 'queue' ? '#ffd60a' : '#2de2e6'));
    const it: Interactable = { kind: k, x: bd.x + nx * 1.6, z: bd.z + nz * 1.6, radius: 2.4 };
    kit.interactables.push(it);
    g.userData.interact = it;
    kit.group.add(g);
  }
  return faces;
}


/** The Fixer: a long coat, shades, and a pin that glows, where the plan has them. */
export function buildHerald(kit: Kit, plan: MapPlan): World['herald'] {
  const hd = plan.herald;
  if (!hd) return undefined;
  const person = new Person(hd.name, '#2a1f3d', { skin: 2, hair: 1, style: 0 });
  const y = kit.floorAt(hd.x, hd.z);
  person.root.position.set(hd.x, y, hd.z);
  person.root.rotation.y = hd.rotY;
  person.setLabel(hd.name, null);
  person.setDoing(hd.says);
  const coat = mesh(
    new THREE.LatheGeometry(
      [
        [0.37, 0.02],
        [0.32, 0.5],
        [0.28, 1.05],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      20,
    ),
    toon('#2a1f3d'),
  );
  person.root.add(coat);
  person.wear(mesh(box(0.5, 0.06, 0.08), toon('#ff2c9c'), 0, 1.05, 0.26, false), 'body');
  // Shades, and the pin of the office.
  person.wear(mesh(box(0.3, 0.07, 0.06), toon('#0a0c12'), 0, 0.76, 0.26, false), 'head');
  person.wear(mesh(box(0.07, 0.08, 0.03), kit.mats.neon('#2de2e6'), 0.13, 0.9, 0.25, false), 'body');
  kit.group.add(person.root);
  const interactable: Interactable = { kind: 'herald', x: hd.x + Math.sin(hd.rotY) * 0.9, y, z: hd.z + Math.cos(hd.rotY) * 0.9, radius: 1.9 };
  person.root.userData.interact = interactable;
  kit.interactables.push(interactable);
  kit.colliders.push({ minX: hd.x - 0.35, maxX: hd.x + 0.35, minZ: hd.z - 0.35, maxZ: hd.z + 0.35, top: 99 });
  return { person, interactable };
}


/** One of CorpSec (the map's escort): an armoured vest, a visor that glows, and a stun baton. */
export function corpsSec(kit: Kit, name: string, color: string): Person {
  const person = new Person(name, color, { skin: 3, hair: 0, style: 6 });
  person.setLabel(name, null);
  const { steelDark, steel } = kit.mats;
  const helm = new THREE.Group();
  helm.add(mesh(new THREE.SphereGeometry(0.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.85), steelDark, 0, 0.03, -0.01));
  const visor = mesh(box(0.44, 0.1, 0.12), kit.mats.neon(color), 0, 0.05, 0.26, false);
  visor.rotation.x = -0.1;
  helm.add(visor);
  person.wear(helm, 'head');
  const vest = mesh(
    new THREE.LatheGeometry(
      [
        [0.34, 0.32],
        [0.32, 0.7],
        [0.3, 1.02],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      18,
    ),
    steelDark,
  );
  person.wear(vest, 'body');
  person.wear(mesh(box(0.3, 0.1, 0.04), toon(color), 0, 0.82, 0.29, false), 'body');
  const baton = new THREE.Group();
  baton.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6), steel, 0, 0.1, 0));
  baton.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), kit.mats.neon(color), 0, 0.5, 0, false));
  baton.position.set(0, -0.4, 0.02);
  baton.rotation.x = 0.1;
  person.wear(baton, 'offhand');
  return person;
}


/** The map's escort (MapPlan.sendHome), on watch at its post, and how to call out another. */
export function buildEscort(kit: Kit, plan: MapPlan): World['escort'] {
  const e = plan.sendHome?.escort;
  if (!e) return undefined;
  const make = () => corpsSec(kit, e.name, e.color);
  const person = make();
  person.root.position.set(e.post.x, e.post.y, e.post.z);
  person.root.rotation.y = e.post.rotY;
  kit.group.add(person.root);
  return { post: e.post, guard: person, make };
}
