import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { findWorker, workerRow } from '../office-workers.js';
import { isAgentEffort, isAgentProvider } from '../../shared/protocol.js';
import { OPEN_CODE_MODEL_MAX } from '../../shared/providers.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';

/** Preserve the authenticated helper command alongside tracked communications. */
export async function workerHelper(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (!floor || !me) return send(res, 401, { error: 'Send your own worker ID and bearer hook token' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST /office/workers/helper' });
  try {
    const b = JSON.parse((await readBody(req)) || '{}') as { worker?: unknown; provider?: unknown; model?: unknown; effort?: unknown };
    const host = findWorker(floor.workers.list(), str(b.worker, 64));
    if (typeof host === 'string') return send(res, 404, { error: host });
    if (host.id === me.id) return send(res, 400, { error: "That's you: a helper goes to another worker" });
    if (b.provider !== undefined && (!isAgentProvider(b.provider) || !floor.project.agentProviders.includes(b.provider))) return send(res, 400, { error: 'Unknown agent provider' });
    const provider = isAgentProvider(b.provider) ? b.provider : undefined;
    const r = await floor.sendHelper(host.id, me.name, provider, b.model === undefined ? undefined : str(b.model, OPEN_CODE_MODEL_MAX + 1), isAgentEffort(b.effort) ? b.effort : undefined, floor.workers.ownerOf(me.id));
    if (typeof r === 'string') return send(res, 400, { error: r });
    ctx.toastFloor(floor, `🆘 ${me.name} brought ${r.name} over to help ${host.name}`);
    return send(res, 200, { ok: true, worker: workerRow(r, { pulls: floor.forge.pulls.items, tasks: floor.queue.state().tasks }, me.id) });
  } catch (err) { return send(res, 400, { error: (err as Error).message }); }
}
