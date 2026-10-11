import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import type { ResearchAction } from '../../shared/trading-research.js';
import { readBody, send } from '../http/util.js';
import { localResearch } from './link.js';
export const RESEARCH_WORKER_PATH = '/office/workers/research';
export const RESEARCH_WORKER_TOOLS = [{ name: 'research_task', readOnly: true }, { name: 'submit_research', readOnly: false }] as const;
export async function floorResearchHook(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL, publish: (msg: ServerMsg) => void) {
  const id = url.searchParams.get('worker') ?? '', token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const worker = floor?.workers.authenticate(id, token);
  if (!floor || !worker) return send(res, 401, { error: 'Authenticate with your own worker ID and hook token' });
  if (worker.kind !== 'agent' || worker.planReview || worker.helper || worker.meeting) return send(res, 403, { error: 'Only assigned coding workers can submit research' });
  try {
    const link = localResearch(floor);
    if (req.method === 'GET') return send(res, 200, await link.call(`packet?worker=${encodeURIComponent(id)}`));
    if (req.method !== 'POST') return send(res, 405, { error: 'GET your assignment or POST its result' });
    const body = JSON.parse(await readBody(req, 200_000));
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['assignment', 'lease', 'hypothesis', 'code', 'config', 'summary', 'decision'].includes(k))) throw Error('Submit only assignment, lease and the role’s result fields');
    if (!floor.workers.authenticate(id, token)) return send(res, 401, { error: 'Worker session changed during submission' });
    const action: ResearchAction = body.decision !== undefined ? { action: 'review', ...body, worker: id } : { action: 'submit', ...body, worker: id };
    await link.call('action', action);
    const view = await link.view(); publish({ t: 'research.state', floor: floor.id, view });
    return send(res, 200, { ok: true });
  } catch (error) { return send(res, 400, { error: (error as Error).message }); }
}
