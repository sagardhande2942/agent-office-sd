import type { CuratorClientMsg } from '../../../shared/lore-curator.js';
import type { HandlerMap } from './types.js';
import { here } from './common.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { CuratorSurface } from '../../lore-curator/surface.js';
async function handle(ctx: Ctx, c: Client, write: boolean, action: (service: CuratorSurface) => Promise<unknown>) {
  const floor = here(ctx, c); if (!floor) return;
  if (write && !ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can control the knowledge curator');
  if (!floor.curator) return ctx.warn(c, 'Update this floor host to support the knowledge curator');
  try { await action(floor.curator); ctx.sendTo(c, { t: 'curator.state', floor: floor.id, state: await floor.curator.state() }); }
  catch (error) { ctx.warn(c, error instanceof Error ? error.message : 'Curator action failed'); }
}
export const curatorHandlers = {
  'curator.get': (ctx, c) => handle(ctx, c, false, async () => {}),
  'curator.configure': (ctx, c, m) => handle(ctx, c, true, async service => service.configure(m.settings)),
  'curator.pause': (ctx, c, m) => handle(ctx, c, true, async service => service.pause(m.paused)),
  'curator.run': (ctx, c) => handle(ctx, c, true, async service => service.start()),
  'curator.restore': (ctx, c, m) => handle(ctx, c, true, async service => service.restore(m.id, m.revision)),
  'curator.history': (ctx, c, m) => handle(ctx, c, false, async service => {
    const floor = here(ctx, c); if (floor) ctx.sendTo(c, { t: 'curator.history', floor: floor.id, id: m.id, revisions: await service.history(m.id) });
  }),
} satisfies HandlerMap<CuratorClientMsg>;
