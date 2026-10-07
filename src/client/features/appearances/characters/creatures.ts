import * as THREE from 'three';
import { C, ball, box, cone, face, humanoid, rig, line } from './shapes';
export const creatures = {
  pikachu() {
    const v=rig(C.yellow,C.yellow);ball(v.body,C.yellow,0,.46,0,.24,.25,.18);ball(v.body,C.yellow,0,.79,0,.27,.24,.21);
    for(const s of [-1,1]) {const ear=ball(v.body,C.yellow,s*.17,1.04,0,.055,.22,.045);ear.rotation.z=s*-.22;
      const tip=ball(v.body,C.ink,s*.21,1.19,0,.045,.065,.04);tip.rotation.z=s*-.22;
      ball(v.body,C.red,s*.18,.73,.175,.052,.045,.018);}
    face(v,.83,.2,.11,true,.045);ball(v.body,C.ink,0,.77,.22,.018);
    for(let i=0;i<3;i++){const t=box(v.body,i===0?'#8d5834':C.yellow,.22+i*.065,.40+i*.13,-.19,.13,.18,.06);t.rotation.z=i%2 ? -.6 : .6;}return v;
  },
  totoro() {
    const v=rig('#7a858c','#6b777e');ball(v.body,'#7a858c',0,.55,0,.32,.41,.25);
    ball(v.body,'#e5dfc8',0,.46,.21,.25,.27,.06);
    for(const s of [-1,1])cone(v.body,'#7a858c',s*.16,1.02,0,.06,.22,s*-.1);
    face(v,.82,.19,.13,false,.045);ball(v.body,C.ink,0,.765,.255,.027,.016,.02);
    for(const s of [-1,1])for(let i=0;i<3;i++)box(v.body,C.ink,s*.265,.73+i*.03,.145,.15,.007,.01);
    for(let i=0;i<5;i++){const mark=cone(v.body,'#7a858c',(i%3-1)*.12,.50+Math.floor(i/3)*.11,.267,.032,.055);mark.scale.z=.25;}return v;
  },
  spongebob() {
    const v=rig(C.yellow,C.ink);box(v.body,C.yellow,0,.73,0,.52,.47,.22);
    box(v.body,C.white,0,.44,0,.5,.09,.22);box(v.body,'#99643b',0,.34,0,.49,.13,.23);
    face(v,.81,.125,.125,false,.09);box(v.body,C.red,0,.43,.13,.045,.12,.02);
    for(const s of [-1,1])box(v.body,C.white,s*.028,.62,.13,.043,.065,.02);
    for(const [x,y]of [[-.21,.91],[.21,.92],[-.22,.67],[.2,.64]])ball(v.body,'#d5ad2b',x,y,.117,.025,.037,.012);
    ball(v.body,C.yellow,0,.72,.16,.03,.065,.035);return v;
  },
  doraemon() {
    const v=rig('#258bda',C.white);ball(v.body,'#258bda',0,.46,0,.26,.25,.18);
    ball(v.body,C.white,0,.46,.16,.21,.20,.025);ball(v.body,'#258bda',0,.84,0,.31,.28,.22);
    ball(v.body,C.white,0,.79,.17,.26,.20,.06);face(v,.95,.19,.07,false,.064);
    ball(v.body,C.red,0,.87,.255,.043);box(v.body,C.red,0,.61,.15,.42,.03,.05);ball(v.body,C.yellow,0,.60,.20,.041);
    line(v.body,'#5d7185',[new THREE.Vector3(-.12,.48,.194),new THREE.Vector3(0,.39,.20),new THREE.Vector3(.12,.48,.194)]);
    for(const s of [-1,1])for(let i=0;i<3;i++)box(v.body,C.ink,s*.17,.77+i*.027,.222,.13,.006,.008);
    v.arms.forEach(a=>ball(a,C.white,0,-.22,0,.073));return v;
  },
  stitch() {
    const v=rig('#477fb9','#477fb9');ball(v.body,'#477fb9',0,.46,0,.235,.25,.17);
    ball(v.body,'#93c9d9',0,.46,.16,.14,.18,.025);ball(v.body,'#477fb9',0,.83,0,.30,.23,.20);
    for(const s of [-1,1]){const ear=ball(v.body,'#477fb9',s*.33,.91,-.01,.095,.235,.055);ear.rotation.z=s*-.65;
      const inner=ball(v.body,'#b589a6',s*.33,.92,.045,.062,.185,.012);inner.rotation.z=s*-.65;
      ball(v.body,'#93c9d9',s*.135,.835,.177,.105,.105,.04);}
    face(v,.84,.215,.13,true,.057);ball(v.body,'#244575',0,.78,.24,.07,.04,.04);return v;
  },
  baymax() {
    const v=rig('#eeeef0','#eeeef0');ball(v.body,'#eeeef0',0,.49,0,.30,.34,.22);ball(v.body,'#eeeef0',0,.91,0,.235,.17,.17);
    face(v,.935,.163,.10,true,.023);box(v.body,C.ink,0,.935,.17,.2,.008,.01);
    ball(v.body,'#c4c7cd',.14,.62,.20,.03,.03,.008);return v;
  },
  shrek() {
    const v=humanoid('#eee5ca','#705232','#91b640');
    for(const s of [-1,1]){ball(v.body,'#91b640',s*.27,.91,0,.09,.035,.04);ball(v.body,'#91b640',s*.34,.91,0,.025,.055,.055);box(v.body,'#69513b',s*.16,.51,.14,.095,.27,.03);}
    ball(v.body,'#91b640',0,.79,.21,.11,.065,.07);
    line(v.body,'#4f6a27',[new THREE.Vector3(-.12,.725,.18),new THREE.Vector3(0,.705,.21),new THREE.Vector3(.12,.725,.18)]);return v;
  },
};
