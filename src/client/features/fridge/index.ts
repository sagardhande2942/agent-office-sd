import { restoreVitals } from '../vitals';
import { CAN, CAN_SECONDS } from '../../vitals';
import type { Ctx } from '../../core/context';
import { hintTitle, key } from '../../core/hint';
import { toast } from '../../ui/dom';
import type { Caffeine } from '../coffee/caffeine';
declare module '../../world/types' { interface InteractKinds {
    fridge: true;
  } }
const cans = new WeakMap<Ctx,number>();
export function holdingCan(ctx:Ctx,now:number) { return now < (cans.get(ctx) ?? 0); }
export function installFridge(ctx:Ctx,caffeine:Caffeine) {
 ctx.interactions.define('fridge',{ reach:3,
 hint:()=>({k:`${ctx.office.fridge.open}|${ctx.office.fridge.cans}`,parts:[hintTitle('Fridge'),key('E',ctx.office.fridge.open?'Close':'Open'),...(ctx.office.fridge.open?[key('C','Diet Coke')]:[])]}),
 use:(_it,k)=>{
 if(k==='E') { const open=ctx.office.fridge.toggle(ctx.reduceMotion.matches); ctx.sound.fridgeDoor(open); }
 if(k==='C') {
 if(!ctx.office.fridge.open) return toast('Open the fridge first (E)','warn');
 if(!ctx.office.fridge.takeCan()) return toast('No cans left','warn');
 restoreVitals(ctx,CAN);cans.set(ctx,performance.now()+CAN_SECONDS*1000);
 caffeine.drink(performance.now()/1000);ctx.sound.soda();ctx.hands.sip();toast('Diet Coke: energy and caffeine');
 }
 } });
}
