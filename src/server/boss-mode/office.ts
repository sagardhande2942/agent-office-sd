import type { Ctx } from '../office/context.js';
export function startBossOfficeClock(ctx:Ctx){
  const timer=setInterval(()=>{
    for(const floor of ctx.remoteFloors.values()){
      if(!floor.bossMode.supported())continue;
      const owner=floor.bossMode.state().owner;
      void floor.bossMode.capacity(Math.max(0,Math.min(ctx.machine.room(),10000)),owner,owner?ctx.meOf(owner).admin:true,ctx.maps.state()).catch(()=>{});
    }
  },10000);timer.unref();return()=>clearInterval(timer);
}
