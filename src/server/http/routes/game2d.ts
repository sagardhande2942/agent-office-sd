import path from 'node:path';
import type { Route } from '../router.js';
import { serveFile } from '../static.js';
export const game2dRoute: Route = {
  path: ['/2d', '/2d.html', '/game2d.html'], auth: 'session',
  handle: (ctx, { res }) => serveFile(res, path.join(ctx.publicDir, 'game2d.html'), false),
};
