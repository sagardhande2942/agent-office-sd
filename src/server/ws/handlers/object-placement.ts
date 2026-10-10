import { PLACEMENT_DEFAULTS, validPlacement } from '../../../shared/object-placement.js';
import type { PlacementClientMsg } from '../../../shared/protocol/object-placement.js';
import { placements, flushPlacements } from '../../object-placement/service.js';
import { throttle } from '../../office/client.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';
import { here } from './common.js';

export const placementView: ViewPieces['placements'] = (ctx, floor) => ({ map: 'office', items: floor ? placements(ctx, floor).store.state() : {} });
export const placementHandlers = {
  'placement.set'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    if (msg.floor !== floor.id || msg.map !== 'office' || ctx.maps.plan().id !== 'office') return ctx.warn(c, 'Object placement requires your current office floor');
    if (!Number.isSafeInteger(msg.request) || msg.request < 0 || typeof msg.final !== 'boolean') return;
    const scene = placements(ctx, floor);
    if (!validPlacement(msg.id, msg.transform)) {
      if (typeof msg.id === 'string' && Object.hasOwn(PLACEMENT_DEFAULTS, msg.id)) ctx.sendTo(c, { t: 'placement.rejected', floor: floor.id, map: 'office', id: msg.id, request: msg.request,
        transform: scene.store.get(msg.id) ?? PLACEMENT_DEFAULTS[msg.id], reason: 'That placement is outside the editable limits' });
      return;
    }
    // Final gestures always go through; preview traffic is bounded per connection.
    if (!msg.final && !throttle(c, 'placement.preview', 25)) return;
    scene.store.set(msg.id, msg.transform, msg.onlyIfMissing === true);
    const update = { t: 'placement.changed' as const, floor: floor.id, map: 'office', id: msg.id, transform: scene.store.get(msg.id)!, by: c.id, request: msg.request, saved: !scene.store.unsaved };
    if (scene.store.unsaved) scene.latest.set(msg.id, update);
    ctx.toFloor(floor, update);
    if (msg.final) {
      try { flushPlacements(ctx, floor); }
      catch { ctx.warn(c, 'Object placement could not be saved to disk; the office will retry.'); }
    }
  },
} satisfies HandlerMap<PlacementClientMsg>;
export const placementHooks: FeatureHooks = {
  leaving(ctx, _c, floor) { if (floor) { try { flushPlacements(ctx, floor); } catch { /* Clock retries. */ } } },
  closedOn(ctx, _c, floor) { try { flushPlacements(ctx, floor); } catch { /* Clock retries. */ } },
};
