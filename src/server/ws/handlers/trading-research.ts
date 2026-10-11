import type { ResearchClientMsg } from '../../../shared/trading-research.js';
import type { HandlerMap } from './types.js';
import { here } from './common.js';
import { researchSurface } from '../../trading-research/link.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
async function handle(ctx: Ctx, c: Client, msg: ResearchClientMsg) {
  const floor = here(ctx, c); if (!floor) return;
  if (msg.t !== 'research.get' && !ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can control research campaigns');
  try {
    const service = researchSurface(floor);
    const view = msg.t === 'research.configure' ? await service.configure(msg)
      : msg.t === 'research.action' ? await service.action(msg.body)
      : msg.t === 'research.dispatch' ? await service.dispatch(msg.assignment, msg.worker, c.peer.name) : await service.view();
    if (msg.t === 'research.get') ctx.sendTo(c, { t: 'research.state', floor: floor.id, view });
    else ctx.toFloor(floor, { t: 'research.state', floor: floor.id, view });
  } catch (error) { ctx.warn(c, (error as Error).message); }
}
export const researchHandlers = {
  'research.get': (ctx, c, msg) => handle(ctx, c, msg),
  'research.configure': (ctx, c, msg) => handle(ctx, c, msg),
  'research.action': (ctx, c, msg) => handle(ctx, c, msg),
  'research.dispatch': (ctx, c, msg) => handle(ctx, c, msg),
} satisfies HandlerMap<ResearchClientMsg>;
