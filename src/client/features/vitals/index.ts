import { builtFloors } from '../../core/floors';
import type { Parts } from '../../core/parts';
import type { Ctx } from '../../core/context';
import { Vitals, type Remedy } from '../../vitals';
import { Faint } from '../../faint';
import { WAKE_UP } from '../../../shared/layout';
import { closeAllModals, toast } from '../../ui/dom';
import { renderVitals } from './meter';
const meters=new WeakMap<Ctx,Vitals>();
export function restoreVitals(ctx:Ctx,remedy:Remedy) { meters.get(ctx)?.drink(remedy,performance.now()/1000); }
export function installVitals(ctx:Ctx,parts:Pick<Parts,'place'|'travel'>) {
 const vitals=new Vitals(),faint=new Faint(),effect=ctx.player.effects.add(); meters.set(ctx,vitals);
 const shade=document.createElement('div');shade.style.cssText='position:fixed;inset:0;background:black;opacity:0;pointer-events:none;z-index:100'; document.body.append(shade);
 let was='up',wakingOutside=false;
 const outside=()=>{ctx.player.pos.set(WAKE_UP.x,ctx.player.street,WAKE_UP.z);ctx.player.facing=WAKE_UP.rotY;ctx.player.enabled=true;shade.style.opacity='0';};
 ctx.messages.on('floor.enter',()=>{if(wakingOutside){wakingOutside=false;outside();}});
 ctx.keys.add('guard',()=>faint.down);
 ctx.ticks.add('pre',({dt,now})=>{
  const secs=now/1000; const phase=faint.update(dt,!ctx.trip()&&vitals.spent(secs));
  effect.speed=vitals.legs(secs); effect.jitter=ctx.reduceMotion.matches?0:vitals.nerves(secs);
  ctx.player.prone=faint.fall;ctx.me.fainted(faint.down?1:0);renderVitals(vitals,secs);
  if(phase===was)return;was=phase;
  if(phase==='falling') { closeAllModals();ctx.activities.stopAll('map');ctx.player.stand();ctx.player.clearKeys();ctx.player.enabled=false;ctx.net.send({t:'act',faint:true});toast('You need a break — you fainted','warn'); }
  if(phase==='out')shade.style.opacity='1';
  if(phase==='wake') { vitals.reset(secs);faint.clear();was='up';ctx.player.prone=0;ctx.me.fainted(0);if (!ctx.inOffice()) parts.place.placeAtSpawn();
    else if (ctx.upTop() && builtFloors()[0]) {wakingOutside=true;parts.travel.leaveRoofFor(builtFloors()[0].id);ctx.net.send({t:'act',faint:false});return;}
    else {ctx.player.pos.set(WAKE_UP.x,ctx.player.street,WAKE_UP.z);ctx.player.facing=WAKE_UP.rotY;}ctx.player.enabled=true;shade.style.opacity='0';ctx.net.send({t:'act',faint:false}); }
 });
}
