import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { communications } from '../office/communications.js';
import { findWorker } from '../office-workers.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';

export async function workerCommunications(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own worker ID and bearer hook token' });
  const action = url.pathname.slice('/office/workers'.length);
  try {
    const ledger = communications(ctx, floor), actor = { id: me.id, name: me.name };
    if (req.method === 'GET' && action === '/inbox') return send(res, 200, ledger.inbox(actor));
    if (req.method !== 'POST' || !['/request', '/reply', '/ack'].includes(action)) return send(res, 405, { error: 'GET /inbox or POST /request, /reply, /ack' });
    const body: unknown = JSON.parse((await readBody(req)) || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send an object');
    const b = body as Record<string, unknown>;
    if (action === '/ack') return send(res, 200, { message: ledger.acknowledge(actor, str(b.id, 80)) });
    const request = action === '/reply' ? ledger.get(str(b.id, 80)) : undefined;
    const target = findWorker(floor.workers.list(), action === '/reply' ? request?.from.id ?? '' : str(b.worker, 64));
    if (typeof target === 'string') throw new Error(target);
    if (target.planReview?.locked) throw new Error('Planning participants do not receive inbox messages');
      if (target.kind !== 'agent') throw new Error('Tracked messages are for agents, not shells');
    const context = b.context === undefined ? { branch: me.worktree?.branch ?? floor.project.branch } : b.context;
    const meeting = floor.meetings.state().current;
    const participant = (id: string) => meeting?.seats.some(s => s.workerId === id);
    const link = meeting?.status === 'running' && (participant(me.id) || participant(target.id)) ? { id: meeting.id, round: meeting.round } : undefined;
    const message = action === '/request' ? ledger.request(actor, { id: target.id, name: target.name }, { ...b, context }, link) : ledger.reply(actor, str(b.id, 80), { ...b, context });
    return send(res, 200, { message });
  } catch (err) { return send(res, 400, { error: (err as Error).message }); }
}
