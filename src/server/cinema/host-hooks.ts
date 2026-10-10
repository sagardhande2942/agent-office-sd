import type http from 'node:http';
import type { Floor } from '../floor.js';
import { REEL_BODY_BYTES } from '../../shared/cinema.js';
import { readReelRequest } from '../office-workers.js';
import { readBody, send } from '../http/util.js';
/** Worker-authenticated, loopback-only upload; the host stores bytes locally and reports metadata. */
export async function hostCinemaHook(req: http.IncomingMessage, res: http.ServerResponse, url: URL, floor: Floor, workerId: string, changed: () => void) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const me = floor.workers.authenticate(workerId, token);
  if (!me) return send(res, 401, { error: 'Send your own worker id and bearer token' });
  if (req.method === 'GET' && url.pathname === '/office/workers/cinema') return send(res, 200, floor.cinema.state());
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET to list, POST to add or remove' });
  let body: unknown;
  try { body = JSON.parse(await readBody(req, REEL_BODY_BYTES)); }
  catch (err) { return send(res, (err as Error).message === 'too large' ? 413 : 400, { error: 'Send a reel within the size limit as JSON' }); }
  if (url.pathname.endsWith('/remove')) {
    const id = (body as { reel?: unknown } | null)?.reel;
    if (typeof id !== 'string' || !/^[a-z0-9]{12}$/.test(id)) return send(res, 400, { error: 'Say which reel to remove' });
    if (!floor.cinema.remove(id, me.name)) return send(res, 404, { error: 'No such reel' });
    changed(); return send(res, 200, { ok: true, reels: floor.cinema.state().reels });
  }
  const ask = readReelRequest(body);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  try {
    const reel = floor.cinema.add({ title: ask.title, pr: ask.pr, by: me.name, shots: ask.shots.map(({ caption, width, height }) => ({ caption, width, height })) }, ask.shots.map(s => s.png));
    changed(); return send(res, 200, { ok: true, reel });
  } catch (err) { return send(res, 500, { error: (err as Error).message }); }
}
export const HOST_CINEMA_PATHS = new Set(['/office/workers/cinema', '/office/workers/cinema/remove']);
