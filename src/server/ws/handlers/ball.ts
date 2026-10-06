// The basketball by the hoop on every floor.
import type { FloorActions as Floor } from '../../floor-actions.js';
import type { BallClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { num } from '../../office/input.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

export const ballView: ViewPieces['ball'] = (_ctx, floor) => floor?.court.state() ?? {};
export const ballChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'ball', ball: floor.court.state() });

/** Picking the ball up, or throwing it. */
async function ball(ctx: Ctx, c: Client, msg: BallClientMsg) {
  const floor = ctx.floorOf(c);
  if (!floor) return;
  const changed = msg.t === 'ball.take' ? await floor.court.take(c.id) : await floor.court.throw(c.id, { x: num(msg.x), y: num(msg.y), z: num(msg.z), vx: num(msg.vx), vy: num(msg.vy), vz: num(msg.vz) });
  // Whoever didn't get it (someone else caught it first) is told where it really is.
  if (changed) ballChanged(ctx, floor);
  else ctx.sendTo(c, { t: 'ball', ball: floor.court.state() });
}

export const ballHandlers = {
  'ball.take': ball,
  'ball.throw': ball,
} satisfies HandlerMap<BallClientMsg>;

export const ballHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    // The ball stays on its floor, back under the hoop. That floor hears so once they're off it (see
    // arrived in office/navigation.ts), or their own page would put it down before it knew they'd gone.
    if (was) return () => { void Promise.resolve(was.court.left(c.id)).then(changed => { if (changed) ballChanged(ctx,was); }); };
  },
  closedOn(ctx, c, floor) {
    const result = floor.court.left(c.id);
    const notify = (changed: boolean) => { if (changed) ballChanged(ctx, floor); };
    if (result instanceof Promise) void result.then(notify); else notify(result);
  },
};
