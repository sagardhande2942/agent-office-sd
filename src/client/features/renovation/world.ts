import * as THREE from 'three';
import { BOARDS, TV, MACHINE_MONITOR, SEATING_BY_ID, type DeskDef, type SeatDef } from '../../../shared/layout';
import { RENOVATION_SLOTS, renovationId, type RenovationSlot } from '../../../shared/renovation';
import { CABINET_AT, COFFEE_MACHINE, FRIDGE } from '../../sound/places';
import { editable } from '../object-placement/model';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture, Site } from '../../world/office/fixture';

interface Captured {
  slot: RenovationSlot;
  roots: THREE.Object3D[];
  colliders: Collider[];
  interactables: Interactable[];
}
const captured = new WeakMap<Site, Captured[]>();
/** Adapter around the fixture registry: the fixture still owns its geometry and animation. */
export function renovatable<K extends keyof import('../../world/types').OfficeHandles>(fixture: Fixture<K>, slot: RenovationSlot): Fixture<K> {
  return site => {
    const before = new Set(site.group.children), nc = site.colliders.length, ni = site.interactables.length;
    const built = fixture(site);
    const roots = site.group.children.filter(o => !before.has(o));
    if (built.group) roots.push(built.group);
    let records = captured.get(site);
    if (!records) captured.set(site, records = []);
    records.push({ slot, roots, colliders: [...site.colliders.slice(nc), ...built.colliders ?? []],
      interactables: [...site.interactables.slice(ni), ...built.interactables ?? []] });
    return built;
  };
}

interface PointRecord { target: { x: number; z: number; y?: number }; local: THREE.Vector3 }
function localBox(c: Collider, inverse: THREE.Matrix4) {
  return new THREE.Box3(new THREE.Vector3(c.minX, c.bottom ?? 0, c.minZ), new THREE.Vector3(c.maxX, c.top, c.maxZ)).applyMatrix4(inverse);
}
function contains(root: THREE.Object3D, object: THREE.Object3D) {
  for (let p: THREE.Object3D | null = object; p; p = p.parent) if (p === root) return true;
  return false;
}
/** Runs last, after toys/finishes have joined their desks and all fixture handles exist. */
export const renovation: Fixture = site => {
  for (const record of captured.get(site) ?? []) {
    const { slot } = record;
    let roots = record.roots;
    // A board and its heading form one fixture, so they never drift apart.
    if (slot === 'boards') roots = Array.from({ length: roots.length / 2 }, (_, i) => {
      const group = new THREE.Group(); site.group.add(group);
      group.attach(roots[i * 2]); group.attach(roots[i * 2 + 1]); return group;
    });
    if (slot === 'lamps') for (const root of roots) {
      // The modern finish is a sibling of the original pendant.
      const twin = site.group.children.find(o => o !== root && o.position.equals(root.position));
      if (twin) root.userData.renovationTwin = twin;
    }
    roots.slice(0, RENOVATION_SLOTS[slot].count).forEach((root, index) => {
      // Preserve old IDs and saved layouts for already editable scenery.
      if (root.userData.editable) return;
      site.group.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
      if (bounds.isEmpty()) return;
      const pivot = new THREE.Group();
      pivot.name = renovationId(slot, index);
      pivot.position.set(center.x, 0, center.z);
      site.group.add(pivot); pivot.attach(root);
      if (root.userData.renovationTwin) pivot.attach(root.userData.renovationTwin);
      pivot.updateWorldMatrix(true, true);
      const inverse = pivot.matrixWorld.clone().invert();
      const rootItems = new Set<Interactable>();
      root.traverse(o => { if (o.userData.interact) rootItems.add(o.userData.interact); });
      const points: PointRecord[] = record.interactables.filter(it => rootItems.has(it) || roots.length === 1)
        .map(it => ({ target: it, local: new THREE.Vector3(it.x, it.y ?? 0, it.z).applyMatrix4(inverse) }));
      const anchor = slot === 'tv' ? TV : slot === 'monitor' ? MACHINE_MONITOR : slot === 'boards' ? Object.values(BOARDS)[index] : null;
      const sounds = slot === 'kitchen' ? [COFFEE_MACHINE, FRIDGE] : slot === 'cabinet' ? [CABINET_AT] : [];
      for (const sound of sounds) points.push({ target: sound, local: new THREE.Vector3(sound.x, sound.y, sound.z).applyMatrix4(inverse) });
      if (anchor) points.push({ target: anchor, local: new THREE.Vector3(anchor.x, anchor.y, anchor.z).applyMatrix4(inverse) });
      if (slot === 'lamps') {
        const halo = site.get('night').halos.find(h => Math.abs(h.at.x - center.x) < .01 && Math.abs(h.at.z - center.z) < .01);
        if (halo) points.push({ target: halo.at, local: halo.at.clone().applyMatrix4(inverse) });
      }
      const defs: { target: DeskDef | SeatDef; initial: DeskDef | SeatDef }[] = [];
      for (const desk of site.desks.values()) if (contains(root, desk.group)) defs.push({ target: desk.def, initial: { ...desk.def } });
      for (const it of rootItems) {
        const seat = it.seatId && SEATING_BY_ID.get(it.seatId);
        if (seat) defs.push({ target: seat, initial: { ...seat } });
      }
      // Associate each collider once with the nearest root from its own fixture.
      const solids = record.colliders.filter(c => {
        const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
        const nearest = roots.reduce((best, candidate) => {
          const b = new THREE.Box3().setFromObject(candidate);
          const distance = b.distanceToPoint(new THREE.Vector3(x, Math.min(c.top, .5), z));
          return distance < best.distance ? { root: candidate, distance } : best;
        }, { root, distance: Infinity });
        return nearest.root === root;
      }).map(c => ({ collider: c, box: localBox(c, inverse) }));
      const label = defs[0]?.target.label ?? (slot === 'boards' ? `${Object.values(BOARDS)[index].label} board` : `${RENOVATION_SLOTS[slot].label} ${index + 1}`);
      const entry = editable(pivot, renovationId(slot, index), label);
      entry.onApply = () => {
        for (const p of points) {
          const v = p.local.clone().applyMatrix4(pivot.matrixWorld);
          p.target.x = v.x; p.target.z = v.z;
          if (p.target.y !== undefined) p.target.y = v.y;
        }
        for (const { target, initial } of defs) {
          const v = new THREE.Vector3(initial.x, 'y' in initial ? initial.y : 0, initial.z).applyMatrix4(inverse).applyMatrix4(pivot.matrixWorld);
          target.x = v.x; target.z = v.z; target.rotY = initial.rotY + pivot.rotation.y;
          if ('y' in target) target.y = v.y;
          if ('places' in target && 'places' in initial) {
            target.places = initial.places.map(n => n * pivot.scale.x);
            target.depth = initial.depth * pivot.scale.x; target.out = initial.out * pivot.scale.x;
            target.hips = initial.hips * pivot.scale.x;
          }
        }
        for (const { collider, box } of solids) {
          const b = box.clone().applyMatrix4(pivot.matrixWorld);
          Object.assign(collider, { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, bottom: b.min.y, top: b.max.y });
        }
      };
      entry.colliders = solids.map(s => s.collider);
    });
  }
  captured.delete(site);
  return {};
};
