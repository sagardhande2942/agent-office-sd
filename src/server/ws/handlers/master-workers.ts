import type { MasterWorkersClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { here } from './common.js';
import { team, teamPresets, broadcastTeams } from '../../master-workers/service.js';
import { request } from '../../master-workers/storage.js';
export const masterWorkersView: ViewPieces['masterWorkers'] = (ctx, floor) => {
  const local = ctx.asLocal(floor); if (local) return team(ctx, local).state();
  const presets = teamPresets(ctx).state();
  floor?.masterWorkers?.presets(presets);
  return floor?.masterWorkers?.state() ?? { current: null, past: [], presets };
};
export const masterWorkersHandlers = {
  async 'master-workers.start'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    try {
      const r = request(msg.request);
      if (!floor.project?.branch) throw Error('Master / Workers requires a Git project');
      if ([r.master, ...r.models].some(a => !floor.project!.agentProviders.includes(a.provider))) throw Error('Select installed providers');
      const local = ctx.asLocal(floor);
      if (!local) {
        if (!floor.masterWorkers) throw Error('Update the floor host to support Master / Workers');
        const full = ctx.machine.full(); if (full) throw Error(full);
        if (ctx.ledger.hiringPaused) throw Error(ctx.ledger.hiringPaused);
        floor.masterWorkers.presets(teamPresets(ctx).state());
        floor.masterWorkers.capacity(ctx.machine.room(), floor.workers.list().length, ctx.ledger.hiringPaused);
        ctx.warn(c, await floor.masterWorkers.start(r, c.accountId)); return;
      }
      ctx.withSignIn(c, ctx.claudeFor([r.master, ...r.models].some(a => a.provider === 'claude') ? 'claude' : undefined), () => ctx.withFreshBase(c, local, () => {
        try { team(ctx, local).start(r, c.accountId); } catch (e) { ctx.warn(c, (e as Error).message); }
      }));
    } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  async 'master-workers.control'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    try {
      if (!['pause', 'resume', 'stop'].includes(msg.action)) throw Error('Unknown control');
      const local = ctx.asLocal(floor);
      if (local) team(ctx, local).control(msg.action, c.accountId);
      else if (floor.masterWorkers) {
        floor.masterWorkers.capacity(ctx.machine.room(), floor.workers.list().length, ctx.ledger.hiringPaused);
        ctx.warn(c, await floor.masterWorkers.control(msg.action, c.accountId));
      }
      else ctx.warn(c, 'Update the floor host to support Master / Workers');
    } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'master-workers.preset'(ctx, c, msg) { try { teamPresets(ctx).edit(msg.preset, msg.remove); broadcastTeams(ctx); } catch (e) { ctx.warn(c, (e as Error).message); } },
} satisfies HandlerMap<MasterWorkersClientMsg>;
