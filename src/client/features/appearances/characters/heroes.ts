import * as THREE from 'three';
import { C, ball, box, cone, humanoid, cape, spikyHair, line } from './shapes';
export const heroes = {
  naruto() {
    const v=humanoid('#f68126','#f68126');spikyHair(v,C.yellow);
    box(v.body,C.ink,0,.95,.20,.43,.085,.03);box(v.body,'#c0c8d1',0,.95,.225,.19,.06,.018);
    line(v.body,C.ink,[new THREE.Vector3(-.035,.95,.24),new THREE.Vector3(0,.965,.24),new THREE.Vector3(.03,.945,.24)]);
    box(v.body,C.ink,0,.5,.15,.06,.29,.025);
    for(const s of [-1,1]) for(let i=0;i<3;i++) box(v.body,'#805b46',s*.17,.78+i*.026,.175,.072,.006,.02);
    return v;
  },
  goku() {
    const v=humanoid('#ed6d1f','#ed6d1f');spikyHair(v,C.ink,true);
    box(v.body,C.blue,0,.37,.16,.36,.055,.025);box(v.body,C.blue,0,.59,.14,.17,.14,.03);
    v.arms.forEach(a=>ball(a,C.blue,0,-.20,0,.065,.045,.067));
    ball(v.body,C.white,.12,.51,.155,.055,.055,.015);box(v.body,C.ink,.12,.51,.173,.022,.047,.005);
    return v;
  },
  luffy() {
    const v=humanoid(C.red,C.blue,C.skin,C.ink);
    box(v.body,C.skin,0,.52,.15,.15,.23,.025);ball(v.body,'#dfb765',0,1.04,0,.35,.045,.29);
    ball(v.body,'#e8c77b',0,1.09,-.02,.23,.11,.21);box(v.body,C.red,0,1.06,.21,.36,.035,.015);
    box(v.body,C.yellow,0,.32,.14,.32,.04,.025);return v;
  },
  link() {
    const v=humanoid('#3d9448','#d2b08b',C.skin,'#e2b34b');
    cone(v.body,'#3d9448',0,1.05,-.09,.255,.25,.25);
    for(const s of [-1,1]) cone(v.body,C.skin,s*.26,.85,0,.065,.17,s*-1.2);
    box(v.body,'#715138',0,.39,.16,.4,.035,.025);box(v.body,C.yellow,0,.39,.18,.06,.05,.02);
    const strap=box(v.body,'#715138',0,.51,.155,.04,.25,.02);strap.rotation.z=-.55;
    box(v.body,'#788590',.17,.48,-.18,.07,.62,.045);return v;
  },
  batman() {
    const v=humanoid('#667283','#667283',C.ink);cape(v,C.ink);
    v.eyes.forEach(e=>{if(e.name==='pupil')e.visible=false;});
    ball(v.body,C.skin,0,.735,.18,.12,.065,.035);
    for(const s of [-1,1])cone(v.body,C.ink,s*.17,1.065,0,.065,.19);
    ball(v.body,C.yellow,0,.5,.15,.105,.055,.022);
    box(v.body,C.ink,0,.5,.18,.14,.025,.015);box(v.body,C.yellow,0,.36,.15,.35,.035,.025);return v;
  },
  'spider-man'() {
    const v=humanoid(C.red,C.blue,C.red);v.eyes.forEach(e=>{if(e.name==='pupil')e.visible=false;});
    for(const s of [-1,1]) {
      const patch=ball(v.body,C.ink,s*.105,.855,.196,.083,.092,.035);patch.rotation.z=s*.25;
      const lens=ball(v.body,C.white,s*.105,.855,.225,.06,.073,.016);lens.rotation.z=s*.25;
      for(let i=0;i<3;i++)line(v.body,C.ink,[new THREE.Vector3(s*.025,.51,.17),new THREE.Vector3(s*.075,.51+i*.025,.17),new THREE.Vector3(s*.11,.46+i*.025,.15)],.006);
    }
    ball(v.body,C.ink,0,.51,.17,.025,.055,.014);
    for(let i=0;i<3;i++)line(v.body,'#912d3d',[new THREE.Vector3(-.18,.79+i*.06,.17),new THREE.Vector3(0,.775+i*.06,.225),new THREE.Vector3(.18,.79+i*.06,.17)],.005);
    return v;
  },
  deadpool() {
    const v=humanoid('#ad293d','#ad293d','#ad293d');v.eyes.forEach(e=>{if(e.name==='pupil')e.visible=false;});
    for(const s of [-1,1]){ball(v.body,C.ink,s*.105,.84,.2,.09,.12,.035);ball(v.body,C.white,s*.105,.85,.234,.052,.04,.018);
      const sword=box(v.body,'#8a939c',s*.12,.65,-.19,.035,.65,.035);sword.rotation.z=s*.4;}
    box(v.body,C.ink,0,.36,.16,.36,.045,.035);ball(v.body,C.ink,0,.36,.19,.045,.045,.018);
    const strap=box(v.body,C.ink,0,.52,.15,.05,.25,.03);strap.rotation.z=.45;return v;
  },
  'darth-vader'() {
    const v=humanoid('#242832','#242832','#171b24');cape(v,'#141821');
    ball(v.body,'#171b24',0,.87,-.015,.285,.27,.23);
    cone(v.body,'#323a47',0,.765,.19,.12,.18,Math.PI);
    box(v.body,'#141821',0,.86,.22,.28,.055,.035);
    for(const s of [-1,1])box(v.body,'#8694a1',s*.065,.765,.27,.015,.09,.012);
    box(v.body,'#151923',0,.51,.17,.16,.15,.025);
    for(let i=0;i<3;i++)box(v.body,[C.red,C.blue,C.white][i],(i-1)*.044,.52,.19,.025,.03,.014);
    return v;
  },
};
