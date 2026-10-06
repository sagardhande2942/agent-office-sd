import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { floorReport, writeManagerNote } from '../manager.js';
import { readBody, send } from '../http/util.js';
import { str } from '../office/input.js';

/** Authenticated floor reports and manager notes, separate from worker management. */
export async function workerManager(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const id = url.searchParams.get('worker') ?? '';
  const floor = ctx.workerFloor(id);
  const actor = floor?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (!floor || !actor) return send(res, 401, { error: 'Send your own worker ID and hook token' });
  if (actor.planReview?.locked) return send(res, 403, { error: 'Planning participants can only use their role plan tools' });
  if (url.pathname === '/office/report') {
    if (req.method !== 'GET') return send(res, 405, { error: 'GET /office/report' });
    return send(res, 200, floorReport(ctx, floor));
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST /office/workers/report' });
  let body: { kind?: unknown; text?: unknown };
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(res, 400, { error: 'Send JSON' }); }
  const kind = body?.kind === 'question' ? 'question' : body?.kind === undefined || body.kind === 'standup' ? 'standup' : undefined;
  if (!kind) return send(res, 400, { error: '--kind is standup or question' });
  const text = str(body?.text, 20_000).replace(/\r\n?/g, '\n').trim();
  if (!text) return send(res, 400, { error: 'Say what to report: text' });
  const file = writeManagerNote(floor.dir, { at: Date.now(), worker: actor.name, kind, text });
  ctx.toastFloor(floor, `${kind === 'question' ? '❓' : '🧭'} ${actor.name}: ${text.split('\n')[0].slice(0, 160)}`, kind === 'question' ? 'warn' : 'info');
  return send(res, 200, { ok: true, kind, file });
}
