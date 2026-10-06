import type { ClientMsg } from '../../../shared/protocol.js';
import { isAgentProvider, isAgentEffort } from '../../../shared/protocol.js';
import { str, num } from '../../office/input.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { ViewPieces } from './types.js';
import { TV_OFF } from '../../../shared/tv.js';

export const tvView: ViewPieces['tv'] = (_ctx, floor) => floor?.tv.state() ?? TV_OFF;
export const helpersView: ViewPieces['helpers'] = (ctx, floor) => floor?.helpers?.states() ?? [];
export const forkHandlers = {
  'worker.helper'(ctx: Ctx, c: Client, msg: Extract<ClientMsg, {t: 'worker.helper'}>) {
    const floor = ctx.floorOf(c);
    if (!floor) return;
    const provider = isAgentProvider(msg.provider) ? msg.provider : undefined;
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    ctx.withSignIn(c, ctx.claudeFor(provider ?? floor.workers.officeDefault.provider), () => {
      void Promise.resolve(floor.sendHelper(str(msg.hostId, 32), c.peer.name, provider, msg.model, effort, c.accountId)).then(r => {
        if (typeof r === 'string') ctx.warn(c, r);
        else ctx.toastFloor(floor, `${c.peer.name} brought ${r.name} over to help`);
      });
    });
  },
  'tv.play'(ctx: Ctx, c: Client, msg: Extract<ClientMsg, {t:'tv.play'}>) { void Promise.resolve(ctx.floorOf(c)?.tv.play({url: msg.url, position: msg.position}, c.peer.name)).then(r => { if (r && 'error' in r) ctx.warn(c,r.error); }); },
  'tv.pause'(ctx: Ctx, c: Client, msg: Extract<ClientMsg, {t:'tv.pause'}>) { void ctx.floorOf(c)?.tv.pause(msg.position,c.peer.name); },
  'tv.seek'(ctx: Ctx, c: Client, msg: Extract<ClientMsg, {t:'tv.seek'}>) { void ctx.floorOf(c)?.tv.seek(num(msg.position),c.peer.name); },
  'tv.stop'(ctx: Ctx, c: Client) { void ctx.floorOf(c)?.tv.stop(c.peer.name); },
  'tv.theatre'(ctx: Ctx, c: Client, msg: Extract<ClientMsg, {t:'tv.theatre'}>) { void ctx.floorOf(c)?.tv.theatre(msg.on === true,c.peer.name); },
};
