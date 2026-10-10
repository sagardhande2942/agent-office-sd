import * as THREE from 'three';
import type { Collider } from '../../world/types';

export interface Transform { position: number[]; rotation: number[]; scale: number[] }
export interface Editable { id: string; label: string; object: THREE.Object3D; initial: Transform; collider?: Collider; collisionBox?: THREE.Box3 }
export function snapshot(o: THREE.Object3D): Transform {
  return { position: o.position.toArray(), rotation: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() };
}
export function validTransform(v: unknown): v is Transform {
  if (!v || typeof v !== 'object') return false;
  const t = v as Transform;
  return [t.position, t.rotation, t.scale].every(a => Array.isArray(a) && a.length === 3 && a.every(n => typeof n === 'number' && Number.isFinite(n)))
    && t.position.every(n => Math.abs(n) < 1000) && t.rotation.every(n => Math.abs(n) < 1000)
    && t.scale.every(n => n > 0 && n <= 100);
}
export function apply(e: Editable, t: Transform) {
  e.object.position.fromArray(t.position);
  e.object.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  e.object.scale.fromArray(t.scale);
  e.object.updateWorldMatrix(true, true);
  if (e.collider) {
    const b = e.collisionBox!.clone().applyMatrix4(e.object.matrixWorld);
    Object.assign(e.collider, { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, bottom: b.min.y, top: b.max.y });
  }
}
/** Explicit opt-in; gameplay fixtures remain protected by default. IDs must survive rebuilds. */
export function editable(object: THREE.Object3D, id: string, label: string, collider?: Collider) {
  const entry: Editable = { object, id, label, collider, initial: snapshot(object) };
  if (collider) {
    object.updateWorldMatrix(true, false);
    entry.collisionBox = new THREE.Box3(
      new THREE.Vector3(collider.minX, collider.bottom ?? 0, collider.minZ),
      new THREE.Vector3(collider.maxX, collider.top, collider.maxZ),
    ).applyMatrix4(object.matrixWorld.clone().invert());
  }
  object.userData.editable = entry;
  return entry;
}
