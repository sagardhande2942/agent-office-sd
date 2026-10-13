import type { Route } from '../router.js';
import { send } from '../util.js';
import { communications } from '../../office/communications.js';
import { handoffs } from '../../handoff/service.js';
export const handoffRoute: Route = { auth: 'session', method: 'GET', path: '/api/handoffs', async handle(ctx, { res, url }) {
  const id = url.searchParams.get('floor') ?? '';
  try {
    const floor = ctx.floors.get(id);
    if (floor) return send(res, 200, { handoffs: handoffs(floor, communications(ctx, floor)).list() });
    const remote = ctx.remoteFloors.get(id);
    if (remote) { const result = await remote.handoff.list(); return typeof result === 'string' ? send(res, 503, { error: result }) : send(res, 200, result); }
    return send(res, 404, { error: 'Unknown floor' });
  } catch (e) { return send(res, 503, { error: (e as Error).message }); }
} };
