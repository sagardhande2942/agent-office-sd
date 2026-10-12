/**
 * 3D Table tennis table on the balcony: regulation court model, paddles, ball,
 * net, colliders, and fixture definition.
 */
import * as THREE from 'three';
import { PINGPONG_PHYSICS, PINGPONG_TABLE } from '../../../shared/tabletennis';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { PALETTE, box } from '../../world/office/materials';

export interface TableTennisCourt3D {
  group: THREE.Group;
  ball: THREE.Mesh;
  westPaddle: THREE.Group;
  eastPaddle: THREE.Group;
  scoreSign: THREE.Mesh;
  setBall(x: number, y: number, z: number, visible?: boolean): void;
  setPaddle(side: 'west' | 'east', x: number, y: number, z: number, rotY?: number, rotZ?: number): void;
  updateScore(text: string): void;
  update(dt: number): void;
}

/** Builds a detailed ping pong paddle (wood blade and handle with red/black rubber faces). */
function buildPaddle(isWest: boolean): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(PALETTE.wood);
  const red = toon('#e63946');
  const black = toon('#1d2d44');

  // Blade base (wood oval)
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 16), wood, 0, 0, 0, false));
  // Rubber faces
  g.add(mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.003, 16), isWest ? red : black, 0, 0.007, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.003, 16), isWest ? black : red, 0, -0.007, 0, false));
  // Handle
  const handle = mesh(roundedBox(0.024, 0.02, 0.09, 0.005), wood, 0, 0, 0.11, false);
  g.add(handle);

  g.rotation.x = Math.PI / 2;
  return g;
}

/** Builds the full 3D table tennis table, net, paddles, scoreboard and ball. */
export function buildTableTennisTable(): TableTennisCourt3D {
  const { x, y, z, length, width, height, netHeight, thickness } = PINGPONG_TABLE;
  const group = new THREE.Group();
  group.position.set(x, y, z);

  const tableBlue = toon('#1d3557');
  const ink = toon(PALETTE.deskLeg);
  const white = toon('#ffffff');

  // Tabletop slab
  const slabY = height - thickness / 2;
  group.add(mesh(box(length, thickness, width), tableBlue, 0, slabY, 0));

  // Table boundary and center lines
  const lineY = height + 0.001;
  const lineW = 0.02;
  // Side lines along X
  for (const sz of [-width / 2 + lineW / 2, width / 2 - lineW / 2]) {
    group.add(mesh(box(length, 0.002, lineW), white, 0, lineY, sz, false));
  }
  // End lines along Z
  for (const sx of [-length / 2 + lineW / 2, length / 2 - lineW / 2]) {
    group.add(mesh(box(lineW, 0.002, width), white, sx, lineY, 0, false));
  }
  // Center dividing line along X
  group.add(mesh(box(length, 0.002, 0.006), white, 0, lineY, 0, false));

  // Undercarriage and legs
  const legH = height - thickness;
  const legY = legH / 2;
  const legInsetX = length / 2 - 0.28;
  const legInsetZ = width / 2 - 0.18;
  for (const lx of [-legInsetX, legInsetX]) {
    for (const lz of [-legInsetZ, legInsetZ]) {
      group.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, legH, 8), ink, lx, legY, lz, false));
      // Caster wheel at foot
      group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8).rotateZ(Math.PI / 2), ink, lx, 0.02, lz, false));
    }
    // Horizontal cross-bar between leg pairs
    group.add(mesh(box(0.04, 0.03, legInsetZ * 2), ink, lx, legH * 0.35, 0, false));
  }
  // Central under-table support frame
  group.add(mesh(box(length * 0.8, 0.03, width * 0.7), ink, 0, height - thickness - 0.02, 0, false));

  // Net assembly across the middle
  const netLen = width + 0.16;
  const netY = height + netHeight / 2;
  // Net mesh (dark semi-transparent appearance)
  const netMesh = mesh(box(0.006, netHeight, netLen), toon('#3a5a40'), 0, netY, 0, false);
  group.add(netMesh);
  // Net top white tape
  group.add(mesh(box(0.014, 0.015, netLen), white, 0, height + netHeight - 0.007, 0, false));
  // Net side posts and clamps
  for (const sz of [-netLen / 2, netLen / 2]) {
    group.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, netHeight + 0.04, 8), ink, 0, height + netHeight / 2, sz, false));
  }

  // Two paddles resting on the table when idle
  const westPaddle = buildPaddle(true);
  westPaddle.position.set(-0.8, height + 0.015, 0.25);
  westPaddle.rotation.y = 0.3;
  group.add(westPaddle);

  const eastPaddle = buildPaddle(false);
  eastPaddle.position.set(0.8, height + 0.015, -0.25);
  eastPaddle.rotation.y = -0.3;
  group.add(eastPaddle);

  // Ping pong ball
  const ballMat = toon('#fffbf0');
  const ball = mesh(new THREE.SphereGeometry(PINGPONG_PHYSICS.ballRadius, 16, 12), ballMat, 0, height + 0.04, 0, false);
  group.add(ball);

  // Scoreboard sign mounted beside the table (facing south into court)
  const scoreSign = textPlane('🏓 Table Tennis · 0 - 0', { bg: '#2b2d42', color: '#ffd166', size: 48, border: '#ffffff' });
  scoreSign.scale.multiplyScalar(0.55);
  scoreSign.position.set(0, 1.4, -width / 2 - 0.35);
  // Post holding the score sign
  group.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), ink, 0, 0.7, -width / 2 - 0.35, false));
  group.add(scoreSign);

  return {
    group,
    ball,
    westPaddle,
    eastPaddle,
    scoreSign,
    setBall(bx: number, by: number, bz: number, visible = true) {
      ball.position.set(bx - x, by - y, bz - z);
      ball.visible = visible;
    },
    setPaddle(side: 'west' | 'east', px: number, py: number, pz: number, rotY = 0, rotZ = 0) {
      const p = side === 'west' ? westPaddle : eastPaddle;
      p.position.set(px - x, py - y, pz - z);
      p.rotation.y = (side === 'west' ? Math.PI / 2 : -Math.PI / 2) + rotY;
      p.rotation.z = rotZ;
    },
    updateScore(text: string) {
      // Re-create text plane or update. The text is kept on the sign too, so what the board says
      // can be read without looking at the pixels of it.
      scoreSign.material = textPlane(text, { bg: '#2b2d42', color: '#ffd166', size: 48, border: '#ffffff' }).material;
      scoreSign.userData.text = text;
    },
    update(_dt: number) {},
  };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** Table tennis on the balcony. */
    tableTennis: TableTennisCourt3D;
  }
}

/** The table tennis fixture on the extended balcony. */
export const tableTennis: Fixture<'tableTennis'> = (site) => {
  const court = buildTableTennisTable();
  const { x, z, length, width, height } = PINGPONG_TABLE;

  // Solid table collider preventing players from walking inside the table
  const col: Collider = {
    minX: x - length / 2 - 0.05,
    maxX: x + length / 2 + 0.05,
    minZ: z - width / 2 - 0.05,
    maxZ: z + width / 2 + 0.05,
    bottom: 0,
    top: height + 0.05,
  };
  site.colliders.push(col);

  // Table tennis interactable
  const it: Interactable = { kind: 'pingpong', x, z, radius: 3.6 };
  court.group.userData.interact = it;
  site.interactables.push(it);

  return {
    group: court.group,
    colliders: [col],
    interactables: [it],
    update: (_t, dt) => court.update(dt),
    handle: { tableTennis: court },
  };
};
