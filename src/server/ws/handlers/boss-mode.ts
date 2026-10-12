import type { BossClientMsg } from '../../../shared/boss-mode/types.js';
import { bossInitial } from '../../../shared/boss-mode/config.js';
import type { HandlerMap,ViewPieces } from './types.js';
import { here } from './common.js';
import { floorBoss } from '../../boss-mode/service.js';
export const bossModeView:ViewPieces['bossMode']=(ctx,floor)=>{
  const local=ctx.asLocal(floor);return local?floorBoss(local).state():floor?.bossMode?.state()??bossInitial();
};
export const bossModeHandlers={
  'boss.get'(ctx,c){const floor=here(ctx,c);if(floor)ctx.sendTo(c,{t:'boss.state',floor:floor.id,state:bossModeView(ctx,floor)!});},
  async 'boss.control'(ctx,c,msg){
    const floor=here(ctx,c);if(!floor)return;
    if(!ctx.meOf(c.accountId).admin)return ctx.warn(c,'Only admins can control Boss mode');
    try{
      const local=ctx.asLocal(floor);
      if(local)await floorBoss(local).control(msg.control,c.accountId);
      else {
        if(!floor.bossMode)throw Error('Update the floor host to support Boss mode');
        await floor.bossMode.capacity?.(Math.max(0,Math.min(ctx.machine.room(),10000)),c.accountId,true,ctx.maps.state());
        await floor.bossMode.control(msg.control,c.accountId);
      }
      ctx.sendTo(c,{t:'boss.state',floor:floor.id,state:bossModeView(ctx,floor)!});
    }catch(error){ctx.warn(c,(error as Error).message);}
  },
} satisfies HandlerMap<BossClientMsg>;
