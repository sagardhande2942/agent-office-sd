import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { apply, editable, snapshot, validTransform } from '../src/client/features/object-placement/model';
import { PlacementSave } from '../src/client/features/object-placement/persistence';

test('independent object/floor records, exact reload and corrupt records', () => {
  const data = new Map<string, string>(); let writes = 0;
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { writes++; data.set(k, v); } };
  const save = new PlacementSave(storage, () => assert.fail('storage failed'));
  const a = { position: [1.234, 0, -3], rotation: [0, .123, 0], scale: [.7, .7, .7] };
  const b = { position: [2, 0, 4], rotation: [0, 1, 0], scale: [2, 2, 2] };
  for (let i = 0; i < 100; i++) save.queue('floor1', 'plant', a);
  save.queue('floor1', 'rug', b); save.queue('floor2', 'plant', b);
  assert.equal(writes, 0); assert.ok(save.flush()); assert.equal(writes, 3);
  const reload = new PlacementSave(storage, () => {});
  assert.deepEqual(reload.load('floor1', 'plant'), a); assert.deepEqual(reload.load('floor1', 'rug'), b);
  assert.deepEqual(reload.load('floor2', 'plant'), b); assert.equal(reload.load('floor1', 'new'), null);
  data.set(save.key('floor1', 'plant'), '{broken'); assert.equal(reload.load('floor1', 'plant'), null);
  assert.deepEqual(reload.load('floor1', 'rug'), b);
});

test('failed final save retains pending records and retries', () => {
  let fail = true, failures = 0; const data = new Map<string, string>();
  const save = new PlacementSave({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { if (fail) throw Error('quota'); data.set(k, v); } }, () => failures++);
  const t = snapshot(new THREE.Group()); save.queue('scene', 'id', t);
  assert.equal(save.flush(), false); assert.equal(failures, 1); assert.deepEqual(save.load('scene', 'id'), t);
  fail = false; assert.equal(save.flush(), true); assert.deepEqual(save.load('scene', 'id'), t);
});

test('transforms update collision bounds and reset without mutating defaults', () => {
  const parent = new THREE.Group(), o = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1));
  parent.add(o); o.position.y = 1;
  const collider = { minX: -1, maxX: 1, minZ: -.5, maxZ: .5, top: 2 };
  const e = editable(o, 'box', 'Box', collider), initial = structuredClone(e.initial);
  apply(e, { position: [5, 2, 3], rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] });
  assert.ok(Math.abs(collider.minX - 4) < 1e-6); assert.ok(Math.abs(collider.maxZ - 5) < 1e-6);
  assert.equal(collider.top, 4); apply(e, e.initial); assert.deepEqual(snapshot(o), initial); assert.deepEqual(e.initial, initial);
  assert.equal(parent.userData.editable, undefined);
});

test('invalid transform records are rejected', () => {
  for (const v of [null, {}, { position: [NaN, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 0, 1] }]) assert.equal(validTransform(v), false);
});
