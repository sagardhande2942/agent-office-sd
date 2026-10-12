import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import type { Interactable } from '../../world/types';
import { aside,hintTitle,key,onE } from '../../core/hint';
import { Person } from '../../world/character';
import { lookFromSeed } from '../../../shared/avatar';
import { seatAt } from '../../../shared/layout';
import { bossPosition } from '../../../shared/boss-mode/presence';
import { store } from '../../state';
import { openBossConsole } from '../../shared/boss-mode/console';
import { BossOfficeMonitor } from './monitor';
import { PALETTE_ENTRIES } from '../palette';
import { h } from '../../ui/dom';
declare module '../../world/types' {interface InteractKinds {
  bossoffice: true;
}}
export function installBossMode(ctx:Ctx,parts:Pick<Parts,'waiting'|'views'>){
  const showBoss=()=>openBossConsole(ctx.net,id=>parts.waiting.openWorkerTerminal(id));
  const character=new Person('Boss','#e8c547',lookFromSeed('office-boss'));
  character.root.name='boss-mode-avatar';
  ctx.scene.add(character.root);character.root.visible=false;
  const boss:Interactable={kind:'bossoffice',x:0,z:0,y:0,radius:0.7};character.root.userData.interact=boss;
  const monitor=new BossOfficeMonitor(ctx.office.bossScreen),screenPosition=new THREE.Vector3();ctx.office.bossScreen.getWorldPosition(screenPosition);
  const screen:Interactable={kind:'bossoffice',x:screenPosition.x,y:screenPosition.y,z:screenPosition.z,radius:0.8};ctx.office.bossScreen.userData.interact=screen;
  ctx.usables.add({usable:()=>character.root.visible?[boss]:[],pickable:()=>character.root});
  ctx.usables.add({usable:()=>ctx.inOffice()?[screen]:[],pickable:()=>ctx.office.bossScreen});
  ctx.interactions.define('bossoffice',{reach:3.2,hint:()=>({k:'boss-office-'+store.bossMode.phase,parts:[hintTitle('👔 Boss Office'),aside(store.bossMode.message),key('E','Open command center')]}),use:onE(showBoss)});
  PALETTE_ENTRIES.push(()=>[{icon:'👔',kind:'Action',title:'Boss Office',keywords:['boss','manager','continuous','mission','settings'],open:showBoss}]);
  const count=document.getElementById('worker-count');count?.insertAdjacentElement('afterend',h('button.btn.boss-toggle',{type:'button',onclick:showBoss,title:'Boss Office command center'},'👔 Boss'));
  let lastDraw=0,lastVersion=-1,lastActivity='',lastConnected=true;
  ctx.ticks.add('others',({dt,t})=>{
    const state=store.bossMode,now=Date.now(),connected=ctx.net.up&&store.currentFloor()?.host?.reachable!==false;
    if(now-lastDraw>500&&(state.revision!==lastVersion||connected!==lastConnected)){monitor.draw(state,!connected);lastVersion=state.revision;lastDraw=now;lastConnected=connected;}
    // The logical boss has one mobile avatar; its underlying terminal remains available.
    for(const [id,view] of parts.views.workerViews){const w=store.workers.get(id);if(w?.bossMode?.role==='boss'||id===state.team?.current?.masterId||id===state.discovery?.workerId)view.model.root.visible=false;}
    character.root.visible=!!state.presence&&!ctx.upTop()&&!ctx.trip();if(!state.presence||!character.root.visible)return;
    const p=bossPosition(state.presence,now);character.root.position.set(...p.at);character.root.rotation.y=p.face;
    const place=state.presence.seat?seatAt(state.presence.seat):undefined;
    const occupied=place&&[...store.peers.values()].some(peer=>peer.floor===store.floor&&peer.seat===place.key);
    character.sit(!p.walking&&place&&!occupied?place.hips:null);
    character.update(dt,t,p.walking,false);
    if(lastActivity!==state.presence.activity){lastActivity=state.presence.activity;character.say(lastActivity,12);}
    boss.x=p.at[0];boss.y=p.at[1];boss.z=p.at[2];
  });
  return {showBoss};
}
