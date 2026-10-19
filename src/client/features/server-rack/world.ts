import * as THREE from 'three';
import { FLOOR, MACHINE_MONITOR } from '../../../shared/layout';
import type { MachineState } from '../../../shared/protocol';
import { beaconState, loadHex, memoryPercent } from '../../shared/server-rack/format';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

/** Standing against the west wall right beneath the machine monitor, facing +x into the room. */
export const SERVER_RACK = {
  x: FLOOR.minX + 0.38,
  z: MACHINE_MONITOR.z,
  width: 0.88,
  depth: 0.68,
  height: 1.36,
} as const;

export interface ServerRack {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
  beaconMat: THREE.MeshToonMaterial;
  update(t: number, machine: MachineState, servicesCount: number, reduceMotion?: boolean): void;
}

function makeLedMat(hex: string): THREE.MeshToonMaterial {
  const m = toonUnique(hex);
  m.emissive.set(hex);
  m.emissiveIntensity = 0.6;
  m.userData.outlineParameters = { visible: false };
  return m;
}

export function buildServerRack(): ServerRack {
  const { x, z, width: W, depth: D, height: H } = SERVER_RACK;
  const group = new THREE.Group();
  const staticParts = new THREE.Group();

  const shell = toon('#2f3640');
  const inner = toon('#191d24');
  const bladeFace = toon('#232933');
  const trim = toon('#59636c');
  const rackGlass = new THREE.MeshBasicMaterial({ color: '#c4d4e0', transparent: true, opacity: 0.28, depthWrite: false });

  // Outer steel cabinet, recessed bay, feet, and cooling vents on top.
  staticParts.add(mesh(roundedBox(W, H, D, 0.04), shell, 0, H / 2, 0));
  staticParts.add(mesh(new THREE.BoxGeometry(W - 0.1, H - 0.16, 0.06), inner, 0, H / 2, D / 2 - 0.02, false));
  for (let i = 0; i < 4; i++) {
    staticParts.add(mesh(new THREE.BoxGeometry(W - 0.18, 0.02, 0.03), trim, 0, H + 0.005, -0.15 + i * 0.1, false));
  }
  for (const sx of [-1, 1]) {
    staticParts.add(mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), trim, sx * (W / 2 - 0.07), 0.025, 0));
  }

  // Top-mounted thermal beacon collar + glowing status dome visible across the room.
  staticParts.add(mesh(new THREE.CylinderGeometry(0.068, 0.08, 0.03, 12), trim, 0, H + 0.015, D / 2 - 0.12));
  const beaconMat = makeLedMat('#06d6a0');
  group.add(mesh(new THREE.CylinderGeometry(0.046, 0.056, 0.075, 12), beaconMat, 0, H + 0.065, D / 2 - 0.12, false));

  // Six horizontal rack blades inside the cabinet.
  const bladeBulb = new THREE.BoxGeometry(0.032, 0.022, 0.014);
  const cpuLeds: THREE.MeshToonMaterial[] = [];
  const memLeds: THREE.MeshToonMaterial[] = [];
  const serviceBlades: THREE.MeshToonMaterial[][] = [];

  for (let r = 0; r < 6; r++) {
    // r = 0 is top blade (CPU), r = 1 is Memory, r = 2..5 are Dev Server blades.
    const y = H - 0.22 - r * 0.185;
    staticParts.add(mesh(new THREE.BoxGeometry(W - 0.16, 0.13, 0.03), bladeFace, 0, y, D / 2 - 0.01, false));
    const rowMats: THREE.MeshToonMaterial[] = [];
    for (let i = 0; i < 5; i++) {
      const mat = makeLedMat(r < 2 ? '#06d6a0' : '#343a56');
      rowMats.push(mat);
      group.add(mesh(bladeBulb, mat, -0.26 + i * 0.13, y, D / 2 + 0.022, false));
    }
    if (r === 0) cpuLeds.push(...rowMats);
    else if (r === 1) memLeds.push(...rowMats);
    else serviceBlades.push(rowMats);
  }

  group.add(mergeByMaterial(staticParts));
  // Frosted glass door in front of the blades.
  group.add(mesh(new THREE.BoxGeometry(W - 0.12, H - 0.18, 0.018), rackGlass, 0, H / 2, D / 2 + 0.01, false));

  // Front header plaque on the top bezel.
  if (typeof document !== 'undefined') {
    const plaque = textPlane('🗄️ SERVER RACK', { bg: '#0d1b2a', color: '#9fdcff', border: '#59636c', size: 36 });
    plaque.scale.multiplyScalar(0.38);
    plaque.position.set(0, H - 0.07, D / 2 + 0.026);
    group.add(plaque);
  }

  group.position.set(x, 0, z);
  group.rotation.y = Math.PI / 2;

  const collider: Collider = {
    minX: FLOOR.minX,
    maxX: x + D / 2 + 0.04,
    minZ: z - W / 2 - 0.04,
    maxZ: z + W / 2 + 0.04,
    top: H + 0.04,
  };

  const interactable: Interactable = {
    kind: 'serverrack',
    x: x + 1.25,
    z,
    radius: 2.2,
  };
  group.userData.interact = interactable;

  const paintGaugeRow = (leds: THREE.MeshToonMaterial[], pct: number, t: number, reduceMotion: boolean) => {
    const lit = Math.max(1, Math.ceil((pct / 100) * leds.length));
    const hex = loadHex(pct);
    const speed = pct >= 90 ? 12 : pct >= 70 ? 7 : 4;
    for (let i = 0; i < leds.length; i++) {
      const m = leds[i];
      if (i < lit) {
        m.color.set(hex);
        m.emissive.set(hex);
        const pulse = reduceMotion ? 0.85 : 0.65 + 0.55 * (0.5 + 0.5 * Math.sin(t * speed + i * 1.3));
        m.emissiveIntensity = pulse;
      } else {
        m.color.set('#283044');
        m.emissive.set('#283044');
        m.emissiveIntensity = 0.12;
      }
    }
  };

  return {
    group,
    collider,
    interactable,
    beaconMat,
    update(t, machine, servicesCount, reduceMotion = false) {
      paintGaugeRow(cpuLeds, machine.cpu, t, reduceMotion);
      paintGaugeRow(memLeds, memoryPercent(machine), t + 0.8, reduceMotion);

      const beacon = beaconState(machine);
      beaconMat.color.set(beacon.hex);
      beaconMat.emissive.set(beacon.hex);
      if (beacon.level === 'critical') {
        beaconMat.emissiveIntensity = reduceMotion ? 1.15 : 0.35 + 1.1 * (0.5 + 0.5 * Math.sin(t * 14));
      } else if (beacon.level === 'warn') {
        beaconMat.emissiveIntensity = reduceMotion ? 0.85 : 0.35 + 0.7 * (0.5 + 0.5 * Math.sin(t * 6));
      } else {
        beaconMat.emissiveIntensity = 0.35;
      }

      for (let b = 0; b < serviceBlades.length; b++) {
        const active = b < servicesCount;
        const row = serviceBlades[b];
        for (let i = 0; i < row.length; i++) {
          const m = row[i];
          if (active) {
            const hex = i === 0 ? '#5dff8a' : '#6ee7ff';
            m.color.set(hex);
            m.emissive.set(hex);
            m.emissiveIntensity = reduceMotion ? 0.9 : 0.45 + 0.75 * (0.5 + 0.5 * Math.sin(t * (8 + b * 3 + i * 2) + i * 1.7));
          } else {
            m.color.set('#283044');
            m.emissive.set('#283044');
            m.emissiveIntensity = 0.1;
          }
        }
      }
    },
  };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The interactive server rack beneath the machine monitor on the west wall. */
    serverRack: ServerRack;
  }
}

export const serverRack: Fixture<'serverRack'> = (site) => {
  const built = buildServerRack();
  site.wall('west', SERVER_RACK.z, SERVER_RACK.height / 2, SERVER_RACK.width + 0.2, SERVER_RACK.height + 0.1);
  return {
    group: built.group,
    colliders: [built.collider],
    interactables: [built.interactable],
    handle: { serverRack: built },
  };
};
