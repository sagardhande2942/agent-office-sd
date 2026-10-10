import * as THREE from 'three';
import { toon } from '../toon';
import type { Fridge } from '../fridge';

/** The exported doors pivot about the two outside edges, in glTF's Y-up coordinates. */
export function samsungFridge(scene: THREE.Object3D, at: { x: number; z: number; rotY?: number }): Fridge | null {
  const left = scene.getObjectByName('fridge_left_hinge');
  const right = scene.getObjectByName('fridge_right_hinge');
  const row = Array.from({ length: 5 }, (_, i) => scene.getObjectByName(`fridge_can_${i}`));
  if (!left || !right || row.some(can => !can)) return null;
  const group = new THREE.Group();
  group.name = 'samsung_fridge';
  group.position.set(at.x, 0, at.z);
  group.rotation.y = at.rotY ?? 0;
  // Fit the existing kitchen collider: 1.1 m wide, 1 m deep, 2.2 m tall.
  scene.scale.set(1.1 / 0.91, 1.23, 1 / 0.76);
  group.add(scene);
  const paint = (material: THREE.Material) => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return material;
    const color = material.name === 'Brushed stainless steel' ? '#adb5bd'
      : material.name === 'Metal edges' ? '#c3c9d2' : material.color;
    return toon(color);
  };
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      // Use the office palette; unlit metallic PBR surfaces otherwise turn dark without an environment map.
      object.material = Array.isArray(object.material) ? object.material.map(paint) : paint(object.material);
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  const interactable: Fridge['interactable'] = {
    kind: 'fridge', x: at.x + Math.sin(at.rotY ?? 0) * 0.9,
    z: at.z + Math.cos(at.rotY ?? 0) * 0.9, radius: 1.7,
  };
  group.userData.interact = interactable;
  let open = false, amount = 0, taken = 0;
  const pose = () => {
    const eased = amount * amount * (3 - 2 * amount);
    left.rotation.y = eased ? -2.02 * eased : 0;
    right.rotation.y = 2.02 * eased;
  };
  pose();
  return {
    group, interactable,
    get open() { return open; },
    get cans() { return row.length - taken; },
    toggle(instant = false) {
      open = !open;
      if (instant) { amount = open ? 1 : 0; pose(); }
      return open;
    },
    update(dt) {
      const target = open ? 1 : 0;
      const step = Math.max(0, dt) * (open ? 1.9 : 2.4);
      amount = amount < target ? Math.min(target, amount + step) : Math.max(target, amount - step);
      pose();
    },
    takeCan() {
      if (!open || taken === row.length) return false;
      row[taken++]!.visible = false;
      return true;
    },
  };
}
