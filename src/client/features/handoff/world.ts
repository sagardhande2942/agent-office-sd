import * as THREE from 'three';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The handoff station's console: a stand-up kiosk out on the open floor, where a worker's handoff
// packet is read before someone continues from it (its window is features/handoff/index.ts). It is a
// fixture of the office floor, so it stands among the furniture, its screen facing -z into the room.

/** Where it stands: the open floor south of the plan comparison table, clear of the desk rugs, the stairs and the dog's bed. */
const STATION = { x: 4.6, z: 8.2, width: 1.6, depth: 0.62, height: 1.3 } as const;

export interface HandoffStationStand {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
}

export function buildHandoffStation(): HandoffStationStand {
  const { x, z, width, depth, height } = STATION;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const shell = toon('#4a4e69');
  const trim = toon('#f2e9e4');
  const paper = toon('#fffaf3');

  // A plinth, the console body, and a lip over the top.
  group.add(mesh(roundedBox(width + 0.12, 0.12, depth + 0.12, 0.05), shell, 0, 0.06, 0));
  group.add(mesh(roundedBox(width, height, depth, 0.08), trim, 0, height / 2 + 0.06, 0));
  group.add(mesh(roundedBox(width + 0.08, 0.06, depth + 0.08, 0.03), shell, 0, height + 0.09, 0));

  // Its screen, tipped back a little so it reads from a step away.
  const screen = textPlane('🤝 HANDOFF', { bg: '#0d1b2a', color: '#e0fbfc', border: '#4a4e69', size: 42 });
  screen.scale.multiplyScalar(width * 0.62);
  screen.rotation.set(-0.22, Math.PI, 0);
  screen.position.set(0, height * 0.74 + 0.06, -depth / 2 - 0.02);
  group.add(screen);

  // The line under it, at the height a step up reads: what E does there.
  const subtitle = textPlane('E · inspect packets', { bg: '#fffaf3', size: 42 });
  subtitle.scale.multiplyScalar(0.42);
  subtitle.rotation.set(-0.12, Math.PI, 0);
  subtitle.position.set(0, height * 0.36 + 0.06, -depth / 2 - 0.01);
  group.add(subtitle);

  // The tray of unfinished work it stands for: a slip of paper each side of a slot.
  group.add(mesh(new THREE.BoxGeometry(width * 0.5, 0.04, 0.02), shell, 0, height + 0.02, -0.12, false));
  for (const [i, tilt] of [0.06, -0.05].entries()) {
    const sheet = mesh(new THREE.PlaneGeometry(0.32, 0.42), paper, -0.24 + i * 0.48, height + 0.14, -0.06, false);
    sheet.rotation.set(-Math.PI / 2 + 0.35, 0, tilt);
    group.add(sheet);
  }

  const collider: Collider = { minX: x - width / 2 - 0.06, maxX: x + width / 2 + 0.06, minZ: z - depth / 2 - 0.06, maxZ: z + depth / 2 + 0.06, top: height + 0.12 };
  const interactable: Interactable = { kind: 'handoffstation', x, z: z - 1.7, radius: 2.4 };
  group.userData.interact = interactable;
  return { group, collider, interactable };
}

/** The console on the office floor (see features/handoff/index.ts for what using it does). */
export const handoffStation: Fixture = () => {
  const built = buildHandoffStation();
  return { group: built.group, colliders: [built.collider], interactables: [built.interactable] };
};
