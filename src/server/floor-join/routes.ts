import { sameOrigin, send } from '../http/util.js';
import type { Route } from '../http/router.js';

export const floorJoinRoutes = {
  pair: {
    auth: 'session', method: 'POST', path: '/api/floor-join/pair',
    handle(ctx, { req, res, session }) {
      if (session.account && session.account.role !== 'admin') return send(res, 403, { error: 'Only admins can pair a machine' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Open this from the office page' });
      if (ctx.hosts.unreadableFile) return send(res, 503, { error: 'The hosts file could not be read; fix it before pairing' });
      const host = new URL(req.url ?? '/', 'http://office').searchParams.get('host') || undefined;
      if (host && ctx.registry.counts().has(host)) return send(res, 409, { error: 'Stop this machine’s floor-host before recovering its connection' });
      const result = ctx.hosts.pair(session.account?.name ?? 'the office UI', host);
      return typeof result === 'string' ? send(res, 400, { error: result }) : send(res, 200, result);
    },
  },
  status: {
    auth: 'session', method: 'GET', path: '/api/floor-join/status',
    handle(ctx, { res, session }) {
      if (session.account && session.account.role !== 'admin') return send(res, 403, { error: 'Only admins can list paired machines' });
      const counts = ctx.registry.counts();
      return send(res, 200, { machines: ctx.hosts.list().filter(h => !h.revokedAt).map(h => ({
        id: h.id, name: h.name, connected: counts.has(h.id),
        floors: ctx.building.list().filter(f => f.host === h.id).map(f => ({ name: f.name, online: ctx.registry.isReachable(f.id) })),
      })) });
    },
  },
} satisfies Record<string, Route>;
