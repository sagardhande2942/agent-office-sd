import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { FloorActions } from '../floor-actions.js';
import type { PlacementServerMsg } from '../../shared/protocol/object-placement.js';
import { Placements } from './storage.js';

interface SceneStore { store: Placements; latest: Map<string, Extract<PlacementServerMsg, { t: 'placement.changed' }>> }
const scenes = new WeakMap<Ctx, Map<string, SceneStore>>();
export function placements(ctx: Ctx, floor: FloorActions): SceneStore {
  let floors = scenes.get(ctx); if (!floors) scenes.set(ctx, floors = new Map());
  let scene = floors.get(floor.id);
  if (!scene) {
    scene = { store: new Placements(path.join(ctx.cfg.dataDir, 'placements', Buffer.from(floor.id).toString('hex') + '.json')), latest: new Map() };
    floors.set(floor.id, scene);
  }
  return scene;
}
export function flushPlacements(ctx: Ctx, floor: FloorActions) {
  const scene = placements(ctx, floor);
  if (!scene.store.flush()) return;
  for (const msg of scene.latest.values()) ctx.toFloor(floor, { ...msg, saved: true });
  scene.latest.clear();
}
/** Retry failed writes, checkpoint long drags, and flush before normal server shutdown. */
export function startPlacementClock(ctx: Ctx): () => void {
  const flush = () => {
    for (const id of scenes.get(ctx)?.keys() ?? []) {
      const floor = ctx.anyFloor(id); if (!floor) continue;
      try { flushPlacements(ctx, floor); } catch (error) { console.error('Could not save object placement', error); }
    }
  };
  const timer = setInterval(flush, 300); timer.unref();
  return () => { clearInterval(timer); flush(); };
}
