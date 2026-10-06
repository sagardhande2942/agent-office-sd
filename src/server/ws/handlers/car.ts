// The cars in every floor's garage.
import type { FloorActions as Floor } from '../../floor-actions.js';
import type { CarClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { num } from '../../office/input.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

export const carsView: ViewPieces['cars'] = (_ctx, floor) => floor?.garage.state() ?? [];
export const carsChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'cars', cars: floor.garage.state() });

/** Getting into a car, or out of one. */
async function seat(ctx: Ctx, c: Client, msg: Extract<CarClientMsg, { t: 'car.enter' | 'car.leave' }>) {
  const floor = ctx.floorOf(c);
  if (!floor) return;
  const changed = msg.t === 'car.enter' ? await floor.garage.enter(c.id, Math.trunc(num(msg.car)), msg.seat) : await floor.garage.leave(c.id);
  // They hear back either way: someone who didn't get in (someone beat them to the seat) learns who did.
  if (changed) ctx.toNeighbors(c, { t: 'cars', cars: floor.garage.state() });
  ctx.sendTo(c, { t: 'cars', cars: floor.garage.state(), answer: true });
}

export const carHandlers = {
  'car.enter': seat,
  'car.leave': seat,
  async 'car.drive'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    const car = Math.trunc(num(msg.car));
    const now = await floor?.garage.drive(c.id, car, { x: num(msg.x), z: num(msg.z), rotY: num(msg.rotY), speed: num(msg.speed), steer: num(msg.steer) });
    if (now) ctx.toNeighbors(c, { t: 'car.move', car, ...now }, true);
  },
  async 'car.honk'(ctx, c) {
    const car = await ctx.floorOf(c)?.garage.honk(c.id);
    if (car !== undefined) ctx.toNeighbors(c, { t: 'car.honk', car });
  },
} satisfies HandlerMap<CarClientMsg>;

export const carHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    // So does a car they were in, parked where they left it.
    if (was) return () => { void Promise.resolve(was.garage.leave(c.id)).then(changed => { if (changed) carsChanged(ctx,was); }); };
  },
  closedOn(ctx, c, floor) {
    const result = floor.garage.leave(c.id);
    const notify = (changed: boolean) => { if (changed) carsChanged(ctx, floor); };
    if (result instanceof Promise) void result.then(notify); else notify(result);
  },
};
