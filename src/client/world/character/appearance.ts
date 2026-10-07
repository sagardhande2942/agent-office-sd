import * as THREE from 'three';
import type { WorkerAppearanceId } from '../../../shared/appearances';
import type { WorkerRig } from './rig';
export interface WorkerVisual { body: THREE.Group; arms: [THREE.Group, THREE.Group]; feet: [THREE.Group, THREE.Group]; eyes: THREE.Mesh[]; pupils: THREE.Object3D[] }
const factories = new Map<WorkerAppearanceId, () => WorkerVisual>();
export function registerWorkerVisual(id: WorkerAppearanceId, make: () => WorkerVisual) { factories.set(id, make); }
export function createWorkerVisual(id: WorkerAppearanceId) { return factories.get(id)?.(); }
/** Factories own geometries; toon materials are cached globally and remain shared. */
export function disposeWorkerVisual(visual: WorkerVisual) {
  const geometries = new Set<THREE.BufferGeometry>();
  for (const part of [visual.body, ...visual.arms, ...visual.feet]) part.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); });
  for (const geo of geometries) geo.dispose();
}
export class WorkerAppearance {
  id: WorkerAppearanceId = 'original';
  eyes: THREE.Mesh[];
  private visual?: WorkerVisual;
  private originals: { object: THREE.Object3D; visible: boolean }[];
  private armParts: THREE.Object3D[][];
  private footGeometry: THREE.BufferGeometry[];
  private empty = new THREE.BufferGeometry();
  private originalPupils: THREE.Object3D[];
  constructor(private rig: WorkerRig, private originalEyes: THREE.Mesh[]) {
    this.eyes = originalEyes;
    this.originalPupils = rig.pupils;
    const retained = new Set<THREE.Object3D>([rig.armL, rig.armR, ...rig.feet, rig.bulbMesh, ...rig.props]);
    this.originals = rig.body.children.filter(o => !retained.has(o)).map(object => ({ object, visible: object.visible }));
    this.armParts = [rig.armL, rig.armR].map(a => [...a.children]);
    this.footGeometry = rig.feet.map(f => f.geometry);
  }
  set(id: WorkerAppearanceId) {
    if (id === this.id) return;
    const next = id === 'original' ? undefined : createWorkerVisual(id);
    if (id !== 'original' && !next) return;
    if (this.visual) {
      for (const part of [this.visual.body, ...this.visual.arms, ...this.visual.feet]) part.removeFromParent();
      disposeWorkerVisual(this.visual);
    }
    if (this.id === 'original') for (const p of this.originals) p.visible = p.object.visible;
    this.id = id; this.visual = next;
    for (const p of this.originals) p.object.visible = next ? false : p.visible;
    this.armParts.forEach(parts => parts.forEach(o => { o.visible = !next; }));
    this.rig.feet.forEach((f,i) => { f.geometry = next ? this.empty : this.footGeometry[i]; });
    if (next) {
      this.rig.body.add(next.body);
      this.rig.armL.add(next.arms[0]); this.rig.armR.add(next.arms[1]);
      this.rig.feet.forEach((f,i) => f.add(next.feet[i]));
    }
    this.eyes = next?.eyes ?? this.originalEyes;
    this.rig.pupils = next?.pupils ?? this.originalPupils;
  }
  dispose() { this.set('original'); this.empty.dispose(); }
}
