import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { Communications } from '../communications.js';
import { readBody, send } from '../http/util.js';
import { codingWorker, executeHandoff } from './service.js';
export const HANDOFF_WORKER_TOOLS = ['list', 'read', 'prefill', 'create', 'accept', 'cancel'].map(action => ({ name: `handoff_${action}`, readOnly: ['list', 'read', 'prefill'].includes(action) }));
export async function floorWorkerHandoff(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL, ledger?: Communications) {
  const id = url.searchParams.get('worker') ?? '', token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const worker = floor?.workers.authenticate(id, token);
  if (!floor || !worker) return send(res, 401, { error: 'Send your own worker ID and hook token' });
  if (!codingWorker(worker)) return send(res, 403, { error: 'Only coding workers may use handoffs' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST a handoff action' });
  try {
    const body = JSON.parse(await readBody(req, 256 * 1024));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Send an object');
    const active = floor.workers.authenticate(id, token);
    if (!active) return send(res, 401, { error: 'Worker session changed while reading request' });
    if (!codingWorker(active)) return send(res, 403, { error: 'Worker role changed while reading request' });
    return send(res, 200, executeHandoff(floor, active, body, ledger));
  } catch (e) { return send(res, 400, { error: (e as Error).message }); }
}
