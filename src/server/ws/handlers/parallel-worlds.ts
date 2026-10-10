import type { WorldsClientMsg } from '../../../shared/protocol/parallel-worlds.js';
import { worldsRequest } from '../../parallel-worlds/storage.js';
import { worlds } from '../../parallel-worlds/service.js';
import type { HandlerMap } from './types.js';
import { here } from './common.js';

export const worldsHandlers = {
  'worlds.start'(ctx, c, msg) {
    const floor = ctx.asLocal(here(ctx, c));
    if (!floor || floor.id !== msg.floor) return ctx.warn(c, 'Parallel worlds requires your current floor to be a local Git project');
    try {
      const r = worldsRequest(msg.request);
      if (!floor.project.agentProviders.includes(r.agent.provider)) throw Error('Choose an installed provider');
      const launch = () => {
        if (ctx.floorOf(c) !== floor || !ctx.stillIn(c) || ctx.floors.get(floor.id) !== floor) return;
        try { worlds(ctx, floor).start(r, c.peer.name, c.accountId); }
        catch (err) { ctx.warn(c, (err as Error).message); }
      };
      ctx.withSignIn(c, ctx.claudeFor(r.agent.provider), () => ctx.withFreshBase(c, floor, launch));
    } catch (err) { ctx.warn(c, (err as Error).message); }
  },
  'worlds.control'(ctx, c, msg) {
    const floor = ctx.asLocal(here(ctx, c));
    if (!floor || floor.id !== msg.floor) return ctx.warn(c, 'The experiment floor changed; reopen Parallel worlds');
    try {
      const controller = worlds(ctx, floor);
      const e = controller.experiment(msg.experiment, c.accountId, ctx.meOf(c.accountId).admin);
      if (msg.action === 'pr') {
        const w = controller.world(e, msg.world);
        if (e.archived || e.winner !== w.id || !w.workerId) throw Error('Select this world before opening its PR');
        const worker = floor.workers.get(w.workerId);
        if (!worker || !['done', 'idle'].includes(worker.status) || worker.lost) throw Error('Wait until the selected worker finishes');
        ctx.withForge(c, floor, async as => {
          if (ctx.floorOf(c) !== floor || e.archived || e.winner !== w.id || !ctx.stillIn(c)) return;
          try {
            const result = await floor.workers.openPr(w.workerId!, c.peer.name, as);
            if (typeof result === 'string') ctx.warn(c, result);
            else {
              for (const failure of result.failed) ctx.warn(c, failure);
              for (const pr of result.prs) ctx.sendTo(c, { t: 'toast', text: `${w.name}: ${pr.url}${pr.dirty ? ' (uncommitted changes are excluded)' : ''}`, level: pr.dirty ? 'warn' : 'info' });
            }
            ctx.toFloor(floor, { t: 'worlds.changed', floor: floor.id });
          } catch (err) { ctx.warn(c, (err as Error).message); }
        });
      } else if (['select', 'archive', 'feedback'].includes(msg.action)) {
        controller.control(e, msg.action, msg.world, msg.text, c.peer.name);
      } else throw Error('Unknown world action');
    } catch (err) { ctx.warn(c, (err as Error).message); }
  },
} satisfies HandlerMap<WorldsClientMsg>;
