import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { HUD_ACTIONS } from '../../ui/menu';
import { openMasterWorkers } from '../../ui/master-workers';
import { PALETTE_ENTRIES } from '../palette';
export function installMasterWorkers(ctx:Ctx,parts:Pick<Parts,'waiting'>) {
  const open=()=>openMasterWorkers(ctx.net,id=>parts.waiting.openWorkerTerminal(id));
  HUD_ACTIONS.push({id:'master-workers',icon:'👑',label:'Master / Workers',section:'Open',title:()=> 'One master, eligible worker models, one PR',run:open});
  PALETTE_ENTRIES.push(()=>[{icon:'👑',kind:'Action',title:'Master / Workers',keywords:['master','team','delegate','workers'],open}]);
}
