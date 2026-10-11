import * as THREE from 'three';
import { FLOOR } from '../../../shared/layout';
import { LORE_SHELF } from '../../../shared/lore';
import { mergeByMaterial, mesh, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

export interface LoreShelfModel {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
}

export function buildLoreShelf(): LoreShelfModel {
  const { width: W, depth: D, height: H } = LORE_SHELF;
  const parts = new THREE.Group();

  const wood = toon('#8b5e3c');
  const woodDark = toon('#6f4528');
  const cork = toon('#c2a677');
  const parchment = toon('#fefae0');
  const parchmentAlt = toon('#faedcd');
  const pinRed = toon('#e63946');
  const pinBlue = toon('#457b9d');

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) =>
    parts.add(mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z));

  // Back panel and sides
  box(W, H, 0.03, woodDark, 0, H / 2, -D / 2 + 0.015);
  box(0.04, H, D, wood, -W / 2 + 0.02, H / 2, 0);
  box(0.04, H, D, wood, W / 2 - 0.02, H / 2, 0);

  // Top crown and base board
  box(W + 0.06, 0.06, D + 0.04, wood, 0, H + 0.03, 0.01);
  box(W - 0.06, 0.08, D - 0.02, woodDark, 0, 0.04, -0.01);

  // Cork board inset in top half
  box(W - 0.1, H * 0.45, 0.02, cork, 0, H * 0.72, -D / 2 + 0.035);

  // Pinned slips of parchment notes on the cork board
  const noteOffsets = [
    { x: -0.45, y: H * 0.76, rot: 0.04, mat: parchment, pin: pinRed },
    { x: -0.15, y: H * 0.70, rot: -0.06, mat: parchmentAlt, pin: pinBlue },
    { x: 0.18, y: H * 0.77, rot: 0.05, mat: parchment, pin: pinRed },
    { x: 0.46, y: H * 0.69, rot: -0.03, mat: parchmentAlt, pin: pinBlue },
  ];

  for (const n of noteOffsets) {
    const noteMesh = mesh(new THREE.PlaneGeometry(0.24, 0.28), n.mat, n.x, n.y, -D / 2 + 0.048);
    noteMesh.rotation.z = n.rot;
    parts.add(noteMesh);

    // Pushpin head
    parts.add(mesh(new THREE.SphereGeometry(0.015, 8, 8), n.pin, n.x, n.y + 0.12, -D / 2 + 0.058));
  }

  // Two lower wooden shelves with lore journals/binders
  const shelfY1 = H * 0.42;
  const shelfY2 = H * 0.18;
  box(W - 0.08, 0.025, D - 0.03, wood, 0, shelfY1, -0.01);
  box(W - 0.08, 0.025, D - 0.03, wood, 0, shelfY2, -0.01);

  // Journal binders on the bottom shelf
  const binderColors = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#f4a261'];
  for (let i = 0; i < 5; i++) {
    box(0.06, 0.22, D * 0.65, toon(binderColors[i]), -0.5 + i * 0.12, shelfY2 + 0.12, 0);
  }

  const group = new THREE.Group();
  group.add(mergeByMaterial(parts));

  // Overhead sign
  const sign = textPlane('📜 Lore Shelf', { size: 36, bg: '#fefae0' });
  sign.position.set(0, H + 0.26, 0.02);
  group.add(sign);

  // Built facing +z, rotated from the west wall into the room (+x)
  group.position.set(LORE_SHELF.x, 0, LORE_SHELF.z);
  group.rotation.y = Math.PI / 2;

  const collider: Collider = {
    minX: FLOOR.minX,
    maxX: LORE_SHELF.x + D / 2 + 0.03,
    minZ: LORE_SHELF.z - W / 2 - 0.04,
    maxZ: LORE_SHELF.z + W / 2 + 0.04,
    top: H + 0.06,
  };

  const interactable: Interactable = {
    kind: 'lore',
    x: LORE_SHELF.x + 1.2,
    z: LORE_SHELF.z,
    radius: 1.6,
  };

  group.userData.interact = interactable;
  return { group, collider, interactable };
}

export const loreShelf: Fixture = (site) => {
  const built = buildLoreShelf();
  site.wall('west', LORE_SHELF.z, (LORE_SHELF.height + 0.55) / 2, LORE_SHELF.width + 0.2, LORE_SHELF.height + 0.55);
  return { group: built.group, colliders: [built.collider], interactables: [built.interactable] };
};
