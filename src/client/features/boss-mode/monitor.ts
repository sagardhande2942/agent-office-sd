import * as THREE from 'three';
import type { BossState } from '../../../shared/boss-mode/types';
export class BossOfficeMonitor {
  readonly canvas=document.createElement('canvas');
  readonly texture=new THREE.CanvasTexture(this.canvas);
  constructor(private screen:THREE.Mesh){this.canvas.width=960;this.canvas.height=540;this.texture.colorSpace=THREE.SRGBColorSpace;const material=screen.material as THREE.MeshBasicMaterial;material.map=this.texture;material.color.set('#ffffff');}
  draw(state:BossState,stale:boolean){
    const g=this.canvas.getContext('2d')!,run=state.team?.current??state.backlog.find(i=>i.id===state.active)?.run;
    g.fillStyle='#111722';g.fillRect(0,0,960,540);g.fillStyle='#e8c547';g.fillRect(0,0,960,7);
    g.font='bold 30px system-ui';g.fillText('BOSS OFFICE',38,57);
    g.font='bold 18px system-ui';g.fillStyle=state.enabled?'#85e0af':'#a4afc0';g.fillText((stale?'DISCONNECTED · ':state.draining?'TURNING OFF · ':'')+(state.enabled?'ON':'OFF')+'  /  '+state.phase.toUpperCase(),38,98);
    g.fillStyle='#ffffff';g.font='bold 24px system-ui';g.fillText((run?.brief??state.message).split('\n')[0].slice(0,65),38,155);
    const metrics=[['TASKS',run?run.tasks.filter(t=>t.status==='done').length+' / '+run.tasks.length:'—'],['WORKERS',run?run.tasks.filter(t=>t.status==='running'||t.status==='review').length+' / '+state.config.maxWorkers:'0 / '+state.config.maxWorkers],['DAILY STARTS',state.starts+' / '+state.config.dailyStarts]];
    metrics.forEach(([label,value],i)=>{const x=38+i*295;g.fillStyle='#202b3b';g.fillRect(x,192,273,95);g.fillStyle='#9baabe';g.font='15px system-ui';g.fillText(label,x+16,220);g.fillStyle='#edf3fd';g.font='bold 32px system-ui';g.fillText(value,x+16,267);});
    g.font='17px system-ui';g.fillStyle='#b7c5d9';g.fillText((state.presence?.activity??state.message).slice(0,90),38,338);
    g.fillStyle=state.phase==='blocked'?'#ffacaf':'#a4afc0';g.fillText((state.events.at(-1)?.message??'Set a mission and configure your team.').replace(/\s+/g,' ').slice(0,90),38,384);
    const item=state.backlog.find(i=>i.id===state.active);g.fillText(item?.pr?'PR delivered · monitoring checks and reviews':'Mission · plans · workers · checks · settings',38,427);
    g.fillStyle='#e8c547';g.font='bold 19px system-ui';g.fillText('E · OPEN BOSS OFFICE',38,505);this.texture.needsUpdate=true;
  }
}
