import type { Route } from '../http/router.js';
import { send } from '../http/util.js';
import { getActivityRecorder } from './service.js';
export const activityHeatmapHostCalls: Record<string, (floor: import('../floor.js').Floor, msg: Record<string, unknown>) => unknown> = {
  'activity-heatmap.snapshot': floor => getActivityRecorder(floor).snapshot(),
};
export const activityHeatmapRoute: Route = {
  auth: 'session', method: 'GET', path: '/api/activity-heatmap',
  async handle(ctx, { res, url }) {
    const id = url.searchParams.get('floor') ?? '', floor = ctx.floors.get(id);
    if (floor) return send(res, 200, getActivityRecorder(floor).snapshot());
    const remote = ctx.remoteFloors.get(id);
    if (!remote) return send(res, 404, { error: 'No such floor' });
    try { return send(res, 200, await remote.activityHeatmap.snapshot()); }
    catch { return send(res, 503, { error: 'Heatmap unavailable: reconnect or update the floor host.' }); }
  },
};
