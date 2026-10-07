import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fictionalFactories, registerFictionalCharacters } from '../src/client/features/appearances/characters/index.js';
import { WorkerAppearance, disposeWorkerVisual } from '../src/client/world/character/appearance.js';
import type { WorkerRig } from '../src/client/world/character/rig.js';
registerFictionalCharacters();
function assembled(v: ReturnType<typeof fictionalFactories.naruto>) {
 const root=new THREE.Group();root.add(v.body);v.arms.forEach((a,i)=>{const g=new THREE.Group();g.position.set(i?.3:-.3,.55,.05);g.add(a);root.add(g);});v.feet.forEach((f,i)=>{const g=new THREE.Group();g.position.set(i?.12:-.12,.2,.05);g.add(f);root.add(g);});return root;
}
test('all twenty visual factories produce finite, distinct desk-sized bodies',()=>{
 const signatures=new Set<string>();
 for(const [id,make]of Object.entries(fictionalFactories)) {
  const v=make();const root=assembled(v);const bounds=new THREE.Box3().setFromObject(root);const size=bounds.getSize(new THREE.Vector3());
  assert.ok(size.x<1.1&&size.y<1.5&&size.z<1,id+': '+size.toArray());
  const meshes:any[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh){const positions=o.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)assert.ok(Number.isFinite(positions.getX(i))&&Number.isFinite(positions.getY(i))&&Number.isFinite(positions.getZ(i)));meshes.push([o.geometry.type,o.position.toArray(),o.scale.toArray(),(o.material as THREE.MeshToonMaterial).color?.getHexString()]);}});
  signatures.add(JSON.stringify(meshes));assert.ok(v.eyes.length>0);disposeWorkerVisual(v);
 }assert.equal(signatures.size,20);
});
test('swaps keep animation anchors and status props; dispose geometry while sharing materials',()=>{
 const body=new THREE.Group();const original=new THREE.Mesh(new THREE.SphereGeometry(.3),new THREE.MeshToonMaterial());body.add(original);
 const arms=[new THREE.Group(),new THREE.Group()];arms.forEach(a=>{a.add(new THREE.Mesh(new THREE.BoxGeometry(.1,.2,.1)));body.add(a);});
 const feet=[new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1)),new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1))];body.add(...feet);
 const bulbMesh=new THREE.Mesh();body.add(bulbMesh);const pupil=new THREE.Mesh();body.add(pupil);
 const rig={body,root:new THREE.Group(),armL:arms[0],armR:arms[1],feet,bulbMesh,pupils:[pupil],props:[]} as unknown as WorkerRig;
 const originalGeometry=feet[0].geometry;const control=new WorkerAppearance(rig,[pupil]);
 for(const id of Object.keys(fictionalFactories)) {control.set(id as any);assert.equal(original.visible,false);assert.equal(rig.armL,arms[0]);assert.equal(rig.bulbMesh.visible,true);assert.equal(arms[0].children.length,2);}
 const visual=arms[0].children[1];let disposed=false;visual.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.addEventListener('dispose',()=>{disposed=true;});});
 control.set('original');assert.equal(disposed,true);assert.equal(original.visible,true);assert.equal(feet[0].geometry,originalGeometry);assert.equal(rig.pupils[0],pupil);assert.equal(arms[0].children.length,1);control.dispose();
});
test('blinking keeps eye centers in place and pupil anchors follow the shared look pose',()=>{
 const v=fictionalFactories.naruto();const root=assembled(v);const eye=v.eyes[0];root.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(eye).getCenter(new THREE.Vector3());
 eye.scale.y=.1;root.updateMatrixWorld(true);assert.ok(center.distanceTo(new THREE.Box3().setFromObject(eye).getCenter(new THREE.Vector3()))<1e-6);
 const pupil=v.pupils[0];const before=pupil.getWorldPosition(new THREE.Vector3());pupil.position.y+=.05;assert.ok(Math.abs(pupil.getWorldPosition(new THREE.Vector3()).y-before.y-.05)<1e-6);disposeWorkerVisual(v);
});
