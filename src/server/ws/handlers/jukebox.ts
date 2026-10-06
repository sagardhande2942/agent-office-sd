// The lounge jukebox on every floor.
import type { FloorActions as Floor } from '../../floor-actions.js';
import { JUKEBOX_TUNES, STREAM } from '../../../shared/jukebox.js';
import type { JukeboxClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const jukeboxView: ViewPieces['jukebox'] = (_ctx, floor) => floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 };
export const jukeboxChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });

export const jukeboxHandlers = {
  async 'jukebox.move'(ctx, c, msg) { const floor = ctx.floorOf(c); if (!floor) return; const r = await floor.jukebox.place(msg.spot); if (typeof r === 'string') ctx.warn(c,r); else jukeboxChanged(ctx,floor); },
  async 'jukebox.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const r = await floor.jukebox.play({ track: msg.track, url: msg.url }, who);
    if ('error' in r) return ctx.warn(c, r.error);
    if (!r.changed) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, floor.jukebox.state().track === STREAM ? `📻 ${who} tuned the jukebox to ${floor.jukebox.title()}` : `🎵 ${who} put on “${floor.jukebox.title()}”`);
  },
  async 'jukebox.skip'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    await floor.jukebox.skip(who);
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, `⏭️ ${who} skipped to “${floor.jukebox.title()}”`);
  },
  async 'jukebox.stop'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor || !await floor.jukebox.stop(who)) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, `🔇 ${who} turned the jukebox off`);
  },
} satisfies HandlerMap<JukeboxClientMsg>;
