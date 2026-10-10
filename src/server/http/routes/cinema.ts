// The screening room's pictures: one shot of a reel at a time, for the screen to draw and for the
// window to show. A shot is a PNG a worker recorded against the build and put in the floor's own data
// directory (see server/cinema.ts), so this is files on this machine, like the whiteboard's.
import type { Ctx } from '../../office/context.js';
import type { Floor } from '../../floor.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const cinemaRoutes = {
  /** `GET /api/cinema/shot?floor=&reel=&n=` — the nth shot of a reel, as a PNG. */
  shot: {
    method: 'GET',
    path: '/api/cinema/shot',
    auth: 'session',
    async handle(ctx: Ctx, { res, url }): Promise<unknown> {
      const floor = ctx.asLocal(floors(ctx, url));
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const reel = str(url.searchParams.get('reel'), 32);
      const n = Number(url.searchParams.get('n'));
      const png = Number.isInteger(n) && n >= 0 ? floor.cinema.frame(reel, n) : undefined;
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

const floors = (ctx: Ctx, url: URL): Floor | undefined => ctx.floors.get(str(url.searchParams.get('floor'), 128));
const str = (v: string | null, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
