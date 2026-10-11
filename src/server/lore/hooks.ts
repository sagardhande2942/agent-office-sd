import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { readBody, send } from '../http/util.js';
import { selectWorkerLore } from '../../shared/worker-lore.js';
import { saveWorkerKnowledge } from './worker.js';

export const LORE_WORKER_PATH = '/office/workers/lore';
export const LORE_WORKER_TOOLS = [{ name: 'worker_lore', readOnly: true }, { name: 'save_worker_lore', readOnly: false }] as const;

/** Loopback only: a running worker's token chooses its floor; no client-supplied floor or author. */
export async function floorWorkerLore(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL, publish: (msg: ServerMsg) => void) {
  const id = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const worker = floor?.workers.authenticate(id, token);
  if (!floor || !worker) return send(res, 401, { error: 'Send your own worker ID and hook token' });
  if (worker.planReview?.locked) return send(res, 403, { error: 'Planning participants cannot use worker memory tools' });
  if (req.method === 'GET') {
    const query = url.searchParams.get('query') ?? (worker.task?.name ?? worker.prompt ?? '').slice(0, 2000);
    if (query.length > 2000) return send(res, 400, { error: 'query must be up to 2000 characters' });
    return send(res, 200, { notes: selectWorkerLore(floor.lore.list(), query) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET repository memory or POST a discovery' });
  try {
    const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
    const active = floor.workers.authenticate(id, token);
    if (!active) return send(res, 401, { error: 'Worker stopped or its session changed while submitting the note' });
    const note = saveWorkerKnowledge(floor.lore, active, body);
    publish({ t: 'lore.saved', note });
    return send(res, 200, { note });
  } catch (err) { return send(res, 400, { error: (err as Error).message }); }
}
