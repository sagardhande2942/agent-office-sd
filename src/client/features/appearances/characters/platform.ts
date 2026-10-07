import * as THREE from 'three';
import { C, ball, box, cone, face, humanoid, rig, line } from './shapes';
function plumber(green: boolean) {
  const color=green ? '#3da548' : C.red;const v=humanoid(color,C.blue,C.skin,'#714632');
  box(v.body,C.blue,0,.49,.145,.23,.2,.03);
  for(const s of [-1,1]) {box(v.body,C.blue,s*.1,.60,.13,.04,.15,.02);ball(v.body,C.yellow,s*.1,.54,.17,.019);ball(v.arms[s<0?0:1],C.white,0,-.22,.01,.077);}
  ball(v.body,color,0,1.005,-.025,.27,.12,.23);ball(v.body,color,0,.99,.20,.27,.035,.13);
  ball(v.body,C.white,0,1.045,.19,.06,.06,.02);box(v.body,color,0,1.045,.218,.018,.05,.009);
  ball(v.body,C.skin,0,.81,.25,.074,.067,.065);
  for(const s of [-1,1])ball(v.body,'#503326',s*.055,.755,.205,.07,.027,.025);
  return v;
}
export const platform = {
  mario:()=>plumber(false),luigi:()=>plumber(true),
  sonic() {
    const v=rig(C.blue,C.red);ball(v.body,C.blue,0,.48,0,.245,.26,.18);ball(v.body,'#efd2a3',0,.49,.16,.135,.18,.027);
    ball(v.body,C.blue,0,.85,-.015,.28,.25,.22);
    for(const s of [-1,1]) {cone(v.body,C.blue,s*.19,1.075,0,.085,.20,s*-.2);cone(v.body,C.blue,s*.22,.89,-.16,.10,.30,s*1.6);ball(v.arms[s<0?0:1],C.white,0,-.22,0,.08);box(v.feet[s<0?0:1],C.white,0,-.025,.075,.18,.03,.06);}
    face(v,.87,.20,.095);ball(v.body,'#efd2a3',0,.76,.19,.2,.09,.06);ball(v.body,C.ink,0,.795,.27,.035);
    return v;
  },
  yoshi() {
    const v=rig(C.green,'#ed7738');ball(v.body,C.green,0,.47,0,.25,.27,.18);ball(v.body,C.white,0,.46,.17,.17,.22,.025);
    ball(v.body,C.green,0,.82,.0,.24,.23,.21);ball(v.body,C.green,0,.77,.22,.245,.16,.21);
    face(v,.94,.13,.10);ball(v.body,C.white,0,.685,.21,.19,.06,.14);
    for(let i=0;i<3;i++)cone(v.body,C.red,0,.72+i*.11,-.21,.06,.12,Math.PI/2);
    ball(v.body,C.red,0,.49,-.18,.17,.08,.08);return v;
  },
  kirby() {
    const v=rig('#ef94b8','#dd326d');ball(v.body,'#ef94b8',0,.59,0,.33,.34,.29);
    v.arms.forEach((a,i)=>{a.clear();ball(a,'#ef94b8',i?-.025:.025,-.08,0,.105,.145,.09);});
    face(v,.68,.265,.09,false,.052);
    for(const s of [-1,1])ball(v.body,'#e96297',s*.19,.57,.245,.055,.025,.012);
    line(v.body,'#84314f',[new THREE.Vector3(-.035,.535,.287),new THREE.Vector3(0,.52,.29),new THREE.Vector3(.035,.535,.287)]);return v;
  },
};
