import * as THREE from 'three';
import { WORLD_APPROACHES } from '../../../shared/parallel-worlds';
import { mesh, textPlane } from '../../world/toon';
import type { Interactable } from '../../world/types';

/** Holographic doors in the open south aisle: deliberately permeable rather than new obstacles. */
export function buildWorldPortals() {
  const root = new THREE.Group();
  const interactables: Interactable[] = [];
  const glows: THREE.MeshBasicMaterial[] = [];
  const labels: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  let names: string[] = WORLD_APPROACHES.map(w => w.name);
  WORLD_APPROACHES.forEach((world, index) => {
    const door = new THREE.Group();
    const x = -3.8 + index * 2.8, z = 8.5;
    door.position.set(x, 0, z);
    const it: Interactable = { kind: 'worldportal', x, z: z - 0.6, radius: 1, deskId: String(index) };
    door.userData.interact = it;
    interactables.push(it);
    const glow = new THREE.MeshBasicMaterial({ color: world.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    glows.push(glow);
    const arch = new THREE.Shape();
    arch.moveTo(-0.85, 0); arch.lineTo(-0.85, 1.6);
    arch.absarc(0, 1.6, 0.85, Math.PI, 0, true); arch.lineTo(0.85, 0);
    const film = mesh(new THREE.ShapeGeometry(arch), new THREE.MeshBasicMaterial({ color: world.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }), 0, 0, 0, false);
    door.add(film);
    for (const side of [-1, 1]) door.add(mesh(new THREE.BoxGeometry(0.045, 1.6, 0.045), glow, side * 0.85, 0.8, 0, false));
    const top = mesh(new THREE.TorusGeometry(0.85, 0.035, 6, 36, Math.PI), glow, 0, 1.6, 0, false); door.add(top);
    const ring = mesh(new THREE.RingGeometry(0.7, 1.05, 40), glow, 0, 0.025, 0, false); ring.rotation.x = -Math.PI / 2; door.add(ring);
    const name = textPlane(world.name, { size: 36, color: world.color, bg: '#111a2c' });
    name.scale.multiplyScalar(0.5); name.position.set(0, 2.7, 0); name.rotation.y = Math.PI; door.add(name);
    labels.push(name);
    root.add(door);
  });
  return { root, interactables, rename(next: string[]) {
    next.forEach((value, i) => {
      if (value === names[i]) return;
      const label = labels[i];
      const replacement = textPlane(value, { size: 36, color: WORLD_APPROACHES[i].color, bg: '#111a2c' });
      label.geometry.dispose(); label.material.map?.dispose(); label.material.dispose();
      label.geometry = replacement.geometry; label.material = replacement.material; names[i] = value;
    });
  }, update(t: number, reduced: boolean) {
    glows.forEach((g, i) => { g.opacity = reduced ? 0.8 : 0.65 + Math.sin(t * 1.5 + i) * 0.15; });
  } };
}
