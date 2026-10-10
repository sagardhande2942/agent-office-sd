import { worldsView } from '../../parallel-worlds/service.js';
import type { Route } from '../router.js';
import { send } from '../util.js';

export const worldsRoute = {
  method: 'GET', path: '/api/parallel-worlds', auth: 'session',
  handle(ctx, { res, url }) {
    const floor = ctx.floors.get(url.searchParams.get('floor') ?? '');
    if (!floor) return send(res, 404, { error: 'Parallel worlds requires a local floor' });
    send(res, 200, worldsView(ctx, floor));
  },
} satisfies Route;
