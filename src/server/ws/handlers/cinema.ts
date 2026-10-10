// The screening room on every floor: the reels its workers recorded, and what's on the screen.
import type { Floor } from '../../floor.js';
import { CINEMA_OFF } from '../../../shared/cinema.js';
import type { CinemaClientMsg } from '../../../shared/protocol.js';
import type { Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import type { HandlerMap, ViewPieces } from './types.js';

/**
 * The screening room's own files, so this floor in this process: the reels its workers recorded against
 * the build (see server/cinema.ts), and which one is on the screen. A hosted floor's reels are pictures
 * on its machine, which the office must never read, so it refuses the room by name (see
 * FloorActions.refuses) exactly as it does the whiteboard.
 */
const localHere = (ctx: Ctx, c: Client): Floor | undefined => {
  const floor = ctx.floorOf(c);
  const local = ctx.asLocal(floor);
  if (floor && !local) ctx.warn(c, floor.refuses('the screening room'));
  return local;
};

/** The reels on a floor, and what's on its screen. */
export const cinemaView: ViewPieces['cinema'] = (ctx, floor) => (ctx.asLocal(floor)?.cinema.state() ?? CINEMA_OFF);

/** Everyone on the floor hears about a change: a reel added or taken off, or the screen changing. */
export const cinemaChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'cinema', state: floor.cinema.state() });

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const cinemaHandlers = {
  async 'cinema.play'(ctx, c, msg) {
    const floor = localHere(ctx, c);
    if (!floor) return;
    const r = floor.cinema.play(str(msg.reel, 32), msg.frame, c.peer.name);
    if ('error' in r) return ctx.warn(c, r.error);
    if (!r.changed) return;
    cinemaChanged(ctx, floor);
    ctx.toastFloor(floor, `🎬 ${c.peer.name} put “${floor.cinema.title()}” on the screening room screen`);
  },
  async 'cinema.pause'(ctx, c, msg) {
    const floor = localHere(ctx, c);
    if (!floor || !floor.cinema.pause(msg.frame, c.peer.name)) return;
    cinemaChanged(ctx, floor);
    ctx.toastFloor(floor, `⏸️ ${c.peer.name} paused “${floor.cinema.title()}”`);
  },
  async 'cinema.stop'(ctx, c) {
    const floor = localHere(ctx, c);
    if (!floor || !floor.cinema.stop(c.peer.name)) return;
    cinemaChanged(ctx, floor);
    ctx.toastFloor(floor, `⏹️ ${c.peer.name} turned the screening room screen off`);
  },
  async 'cinema.remove'(ctx, c, msg) {
    const floor = localHere(ctx, c);
    if (!floor || !floor.cinema.remove(str(msg.reel, 32), c.peer.name)) return ctx.warn(c, 'No such reel in the screening room');
    cinemaChanged(ctx, floor);
    ctx.toastFloor(floor, `🗑️ ${c.peer.name} took a reel off the screening room`);
  },
} satisfies HandlerMap<CinemaClientMsg>;
