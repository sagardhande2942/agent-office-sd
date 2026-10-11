import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { floorWorkerLore, LORE_WORKER_PATH } from '../lore/hooks.js';
import { floorCompletion } from './completion.js';

/** Each worker feature owns its authenticated API; both office and host listeners use this table. */
const ROUTES = [{ path: LORE_WORKER_PATH, handle: floorWorkerLore }, { path: '/office/workers/completion', handle: floorCompletion }, { path: '/office/workers/complete', handle: floorCompletion }] as const;
export const WORKER_FEATURE_PATHS = ROUTES.map(route => route.path);
export async function floorWorkerFeatureHook(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL, publish: (msg: ServerMsg) => void): Promise<boolean> {
  const route = ROUTES.find(route => route.path === url.pathname);
  if (!route) return false;
  await route.handle(floor, req, res, url, publish);
  return true;
}
export function workerFeatureHook(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const floor = ctx.workerFloor(url.searchParams.get('worker') ?? '');
  return floorWorkerFeatureHook(floor, req, res, url, msg => { if (floor) ctx.toFloor(floor, msg); });
}
