import * as THREE from 'three';
import { SCREEN } from '../../../shared/cinema';
import { PALETTE } from '../../world/office/materials';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The screening room: a pull-down screen on the meeting room's wall with a caption plate under it, and
// the lectern the reel is shown from. What is on the screen is drawn by ui.ts, from the floor's own
// pictures (see server/cinema.ts).

export interface ScreeningRoom {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
  /** The picture of the build goes on this: the screen's own size, so it stays crisp. */
  screen: THREE.Mesh<THREE.PlaneGeometry>;
  /** The caption under the screen, repainted for each shot. */
  caption: THREE.Mesh<THREE.PlaneGeometry>;
}

export const screeningRoom: Fixture<'screening'> = (site) => {
  const group = new THREE.Group();
  const { width, height } = SCREEN;
  const bezel = mesh(roundedBox(width + 0.18, 0.08, height + 0.18, 0.05), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  group.add(bezel);
  // A roller case across the top, and a weighted bar down the side: it hangs like a screen, not a TV.
  group.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, width + 0.34, 10), toon('#d9d2c5'), 0, height / 2 + 0.16, 0, false).rotateZ(Math.PI / 2));
  // White, so the picture is the shot and not the tint: a basic material's colour multiplies its map.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  screen.position.z = 0.06;
  group.add(screen);
  // The caption plate: its own canvas, repainted for each shot (see screen.ts), hung just under the
  // screen and above the lectern so nothing stands in front of what is being said.
  const caption = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.3), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true }));
  caption.position.set(0, -height / 2 - 0.26, 0.06);
  caption.userData.outlineParameters = { visible: false };
  group.add(caption);

  group.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
  group.rotation.y = Math.PI; // the meeting room's far wall faces back into the room (-z).
  site.group.add(group);

  // The projector, on its stand to one side of the screen: it throws the picture across it, and it is
  // out of the way of the caption rather than standing in front of it.
  const projector = new THREE.Group();
  projector.add(mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.95, 10), toon(PALETTE.ink), 0, 0.47, 0));
  projector.add(mesh(roundedBox(0.5, 0.05, 0.38, 0.03), toon(PALETTE.ink), 0, 0.96, 0));
  projector.add(mesh(roundedBox(0.34, 0.22, 0.42, 0.05), toon('#f4f1ea'), 0, 1.08, 0));
  const lens = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 12), litLamp(), -0.22, 1.08, 0, false);
  lens.rotation.z = Math.PI / 2;
  projector.add(lens);
  projector.position.set(SCREEN.x - width / 2 - 0.45, 0, SCREEN.z - 1.6);
  projector.rotation.y = -0.5;
  site.group.add(projector);

  // Stand in front of the screen, between it and the table, looking at it (towards +z).
  const interactable: Interactable = { kind: 'cinema', x: SCREEN.x, y: MEETING_ROOM_FLOOR, z: SCREEN.z - 1.9, radius: 2.6 };
  group.userData.interact = interactable;
  site.interactables.push(interactable);
  // The screen's own stretch of wall, so a picture isn't hung over it (see Office.fixtures).
  site.wall('south', SCREEN.x, SCREEN.y, width + 0.2, height + 0.5);

  const collider: Collider = { minX: SCREEN.x - 0.2, maxX: SCREEN.x + 0.2, minZ: SCREEN.z - 0.2, maxZ: SCREEN.z, top: SCREEN.y + height };
  return { group, colliders: [collider], interactables: [interactable], handle: { screening: { group, collider, interactable, screen, caption } } };
};

declare module '../../world/types' {
  interface OfficeHandles {
    /** The screening room in the meeting room: its screen, and what is on it. */
    screening: ScreeningRoom;
  }
}

/** The meeting room's floor is the office's; the screen hangs on its wall at head height. */
const MEETING_ROOM_FLOOR = 0;
/** The projector's lens, lit: its own material so it glows without lighting the room. */
function litLamp() {
  const m = toon('#ffd166') as THREE.MeshToonMaterial;
  m.emissive = new THREE.Color('#ffb703');
  m.emissiveIntensity = 0.4;
  m.userData.outlineParameters = { visible: false };
  return m;
}
