import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { renovatable, renovation } from '../src/client/features/renovation/world';
import { apply, snapshot } from '../src/client/features/object-placement/model';
import { validPlacement } from '../src/shared/object-placement';
import { renovationId } from '../src/shared/renovation';
import type { Site } from '../src/client/world/office/fixture';
import type { DeskView, Interactable } from '../src/client/world/types';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
test('renovation moves occupied desk anchors, interactions and collision bounds together, and resets exactly', () => {
  const group = new THREE.Group();
  const desk = new THREE.Group(); desk.position.set(4, 0, 2);
  desk.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshBasicMaterial()));
  const worker = new THREE.Object3D(); worker.position.set(0, 1, 1); desk.add(worker);
  const def = { id: 'desk-1', label: 'Desk 1', x: 4, z: 2, rotY: 0 };
  const collider = { minX: 3, maxX: 5, minZ: 1.5, maxZ: 2.5, top: 1 };
  const it: Interactable = { kind: 'desk', deskId: def.id, x: 4, z: 3, radius: 1.3 };
  const site = { group, colliders: [], interactables: [], desks: new Map() } as unknown as Site;
  const fixture = renovatable(s => {
    s.group.add(desk); desk.userData.interact = it;
    s.desks.set(def.id, { group: desk, def } as DeskView);
    s.colliders.push(collider); s.interactables.push(it); return {};
  }, 'desks');
  fixture(site); renovation(site);
  const entry = desk.parent!.userData.editable;
  const original = structuredClone(entry.initial), originalWorker = worker.getWorldPosition(new THREE.Vector3()).toArray();
  apply(entry, { position: [8, 0, 5], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] });
  const position = worker.getWorldPosition(new THREE.Vector3());
  near(position.x, 9); near(position.z, 5);
  near(it.x, 9); near(it.z, 5); near(def.x, 8); near(def.z, 5); near(def.rotY, Math.PI / 2);
  near(collider.minX, 7.5); near(collider.maxX, 8.5); near(collider.minZ, 4); near(collider.maxZ, 6);
  assert.deepEqual(entry.colliders, [collider]);
  apply(entry, original);
  assert.deepEqual(snapshot(entry.object), original);
  worker.getWorldPosition(new THREE.Vector3()).toArray().forEach((n, i) => near(n, originalWorker[i]));
  near(def.x, 4); near(def.z, 2); near(it.x, 4); near(it.z, 3);
});
test('renovation IDs are explicitly bounded; placement accepts height and rejects structural objects', () => {
  const transform = { position: [5, 1.5, 3], rotation: [0, .5, 0], scale: [1, 1, 1] };
  assert.equal(validPlacement(renovationId('desks', 15), transform), true);
  assert.equal(validPlacement(renovationId('desks', 16), transform), false);
  for (const id of ['renovation-v1-walls-0', 'renovation-v1-elevator-0', 'renovation-v1-desks-__proto__']) assert.equal(validPlacement(id, transform), false);
  assert.equal(validPlacement(renovationId('desks', 0), { ...transform, position: [0, -1, 0] }), false);
});
