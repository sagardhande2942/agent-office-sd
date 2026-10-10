import { CINEMA_OFF } from '../../../shared/cinema.js';
import type { CinemaClientMsg } from '../../../shared/protocol.js';
import type { FloorActions } from '../../floor-actions.js';
import type { Ctx } from '../../office/context.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const cinemaView: ViewPieces['cinema'] = (_ctx, floor) => floor?.cinema?.state() ?? CINEMA_OFF;
export const cinemaChanged = (ctx: Ctx, floor: FloorActions) => ctx.toFloor(floor, { t: 'cinema', state: floor.cinema?.state() ?? CINEMA_OFF });
const str = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 32) : '';
// Remote hosts publish the authoritative state through their existing event stream.
const changed = (ctx: Ctx, floor: FloorActions) => { if (ctx.asLocal(floor)) cinemaChanged(ctx, floor); };
export const cinemaHandlers = {
  async 'cinema.play'(ctx, c, msg) {
    const floor = ctx.floorOf(c); if (!floor?.cinema) return;
    const r = await floor.cinema.play(str(msg.reel), msg.frame, c.peer.name);
    if ('error' in r) return ctx.warn(c, r.error);
    if (r.changed) { changed(ctx, floor); ctx.toastFloor(floor, `🎬 ${c.peer.name} put a reel on the screening room screen`); }
  },
  async 'cinema.pause'(ctx, c, msg) {
    const floor = ctx.floorOf(c); if (!floor?.cinema) return;
    const r = await floor.cinema.pause(msg.frame, c.peer.name);
    if (typeof r === 'string') return ctx.warn(c, r);
    if (r) { changed(ctx, floor); ctx.toastFloor(floor, `⏸️ ${c.peer.name} paused “${floor.cinema.title()}”`); }
  },
  async 'cinema.stop'(ctx, c) {
    const floor = ctx.floorOf(c); if (!floor?.cinema) return;
    const r = await floor.cinema.stop(c.peer.name);
    if (typeof r === 'string') return ctx.warn(c, r);
    if (r) { changed(ctx, floor); ctx.toastFloor(floor, `⏹️ ${c.peer.name} turned the screening room screen off`); }
  },
  async 'cinema.remove'(ctx, c, msg) {
    const floor = ctx.floorOf(c); if (!floor?.cinema) return;
    const r = await floor.cinema.remove(str(msg.reel), c.peer.name);
    if (typeof r === 'string') return ctx.warn(c, r);
    if (!r) return ctx.warn(c, 'No such reel in the screening room');
    changed(ctx, floor);
    ctx.toastFloor(floor, `🗑️ ${c.peer.name} took a reel off the screening room`);
  },
} satisfies HandlerMap<CinemaClientMsg>;
