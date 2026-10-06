import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { readBody, send } from '../http/util.js';
/** Role restrictions apply to every worker API route, not just its advertised tools. */
export async function workerPlanReview(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/office/workers')) return false;
  const id = url.searchParams.get('worker') ?? '';
  const floor = ctx.workerFloor(id);
  const actor = floor?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const action = url.pathname.slice('/office/workers'.length);
  const plan = action === '/plan' || action === '/plan-review' || action.startsWith('/plan-review/');
  if (!actor || !floor) { if (plan) { send(res, 401, { error: 'Send your own worker ID and hook token' }); return true; } return false; }
  if (actor.planReview?.locked && !['/plan-review', '/plan', '/plan-review/clarify', '/plan-review/verdict'].includes(action)) { send(res, 403, { error: 'Planning participants can only read their activity and submit plans or reviews for their role' }); return true; }
  if (!plan) return false;
  try {
    if (req.method === 'GET' && action === '/plan-review') { send(res, 200, floor.planReviews.view(actor)); return true; }
    if (req.method !== 'POST') { send(res, 405, { error: 'POST the plan, clarification or verdict' }); return true; }
    const body = JSON.parse((await readBody(req)) || '{}');
    const result = action === '/plan' ? floor.planReviews.submitPlan(actor, body) : action === '/plan-review/clarify' ? floor.planReviews.clarify(actor, body) : action === '/plan-review/verdict' ? floor.planReviews.submitReview(actor, body) : undefined;
    send(res, result === undefined ? 404 : 200, result ?? { error: 'Unknown activity action' });
  } catch (err) { send(res, 400, { error: (err as Error).message }); }
  return true;
}
