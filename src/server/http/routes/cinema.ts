// One screenshot from a local floor or its paired host, served to authenticated browsers.
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const cinemaRoutes = {
  /** `GET /api/cinema/shot?floor=&reel=&n=` — the nth shot of a reel, as a PNG. */
  shot: {
    method: 'GET',
    path: '/api/cinema/shot',
    auth: 'session',
    async handle(ctx: Ctx, { res, url }): Promise<unknown> {
      const floor = ctx.anyFloor(str(url.searchParams.get('floor'), 128));
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const reel = str(url.searchParams.get('reel'), 32);
      const n = Number(url.searchParams.get('n'));
      const png = Number.isInteger(n) && n >= 0 ? await floor.cinema?.frame(reel, n) : undefined;
      if (typeof png === 'string') {
        res.setHeader('cache-control', 'no-store');
        return send(res, 503, { error: png });
      }
      if (!png) return send(res, 404, { error: 'No such shot' });
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(png.length),
        // A reel is only ever added to, never changed, so a shot's bytes never change under its URL.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      });
      res.end(png);
      return undefined;
    },
  },
} satisfies Record<string, Route>;

const str = (v: string | null, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
