import * as THREE from 'three';
import { mesh, toon } from '../../../world/toon';
import type { WorkerVisual } from '../../../world/character/appearance';
export const C = { skin: '#ffc999', ink: '#202533', white: '#fff9ed', yellow: '#ffcf35', red: '#e93642', blue: '#2572d7', green: '#55ab47' };
export function ball(parent: THREE.Object3D, color: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) {
  const m = mesh(new THREE.SphereGeometry(1, 16, 12), toon(color), x,y,z); m.scale.set(sx,sy,sz); parent.add(m); return m;
}
export function box(parent: THREE.Object3D, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const m = mesh(new THREE.BoxGeometry(sx,sy,sz), toon(color),x,y,z); parent.add(m); return m;
}
export function cone(parent: THREE.Object3D, color: string, x: number, y: number, z: number, radius: number, height: number, tilt = 0) {
  const m=mesh(new THREE.ConeGeometry(radius,height,8),toon(color),x,y,z); m.rotation.z=tilt;parent.add(m);return m;
}
export function line(parent: THREE.Object3D, color: string, points: THREE.Vector3[], radius = .008) {
  const m=mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),16,radius,5,false),toon(color));parent.add(m);return m;
}
export function rig(armColor: string, shoeColor = C.ink): WorkerVisual {
  const v: WorkerVisual = { body:new THREE.Group(), arms:[new THREE.Group(),new THREE.Group()], feet:[new THREE.Group(),new THREE.Group()],eyes:[],pupils:[] };
  v.arms.forEach((a,i) => { a.position.x=i ? -.035 : .035; ball(a,armColor,0,-.105,0,.065,.16,.065); });
  v.feet.forEach(f => ball(f,shoeColor,0,-.035,.025,.095,.065,.14));
  return v;
}
export function face(v: WorkerVisual, y: number, z: number, spread=.11, dark=false, size=.065) {
  for(const sx of [-1,1]) {
    const eye=ball(v.body,dark ? C.ink : C.white,sx*spread,y,z,size,size*1.15,.025);eye.name='eye';v.eyes.push(eye);
    if(!dark) {
      const anchor=new THREE.Group();anchor.position.y=.7;
      const pupil=ball(anchor,C.ink,sx*spread,y-.7,z+.028,size*.48,size*.65,.018);pupil.name='pupil';
      v.body.add(anchor);v.pupils.push(anchor);v.eyes.push(pupil);
    }
  }
}
export function humanoid(shirt: string, trousers: string, skin=C.skin, hair?: string) {
  const v=rig(shirt);ball(v.body,shirt,0,.49,0,.235,.235,.15);
  box(v.body,trousers,0,.285,0,.35,.14,.24);
  ball(v.body,skin,0,.83,.005,.25,.24,.21);face(v,.84,.205);
  if(hair) ball(v.body,hair,0,1.0,-.045,.25,.10,.20);
  return v;
}
export function cape(v: WorkerVisual, color: string) {
  const p=box(v.body,color,0,.5,-.17,.47,.55,.028);p.rotation.x=-.15;
}
export function spikyHair(v: WorkerVisual, color: string, tall=false) {
  ball(v.body,color,0,1.015,-.03,.25,.11,.21);
  for(let i=0;i<7;i++) cone(v.body,color,(i-3)*.065,1.07+(i%3)*.025,-.04,.065,tall ? .23 : .15,(3-i)*.20);
}
