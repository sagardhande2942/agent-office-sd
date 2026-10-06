import { readBody, send } from '../http/util.js';
import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { checkpointOutput } from './checkpoints.js';
import { normalizeCodexHook } from '../codex.js';
import { DESK_BY_ID } from '../../shared/layout.js';
const stops = new WeakMap<Ctx, Map<string, number>>();
/** One completion reminder per task revision, after outstanding inbox work is handled. */
export function completionCheckpoint(ctx: Ctx, id: string, token: string, route: string, event: string, payload: unknown): Record<string, unknown> {
  const output = checkpointOutput(ctx, id, token, route, event, payload);
  const actor = ctx.workerFloor(id)?.workers.authenticate(id, token);
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const root = !data.agent_id && !data.agent_type && (!data.session_id || !actor?.sessionId || data.session_id === actor.sessionId || event === 'SessionStart');
  const native = actor?.kind === 'agent' && (route === 'claude' ? actor.provider === 'claude' || actor.provider === 'custom' : route === 'codex' && actor.provider === 'codex' && !!normalizeCodexHook(event, payload));
  if (actor && root && native && event === 'Stop' && !data.stop_hook_active && output.decision !== 'block' && !actor.helper && !actor.meeting && !actor.planReview?.locked && !DESK_BY_ID.get(actor.deskId)?.station && (actor.prompt || actor.task) && actor.helperReport?.state !== 'interrupting') {
    const revision = actor.completionRevision ?? 0;
    let reminders = stops.get(ctx); if (!reminders) stops.set(ctx, reminders = new Map());
    if ((!actor.completion || actor.completion.status === 'needs-attention') && reminders.get(id) !== revision) {
      reminders.set(id, revision);
      return { decision: 'block', reason: 'Before claiming this task is complete, record its completion checklist with office-workers complete (JSON on stdin) or submit_worker_completion. Read office-workers completion --json / worker_completion for the current revision. Include summary, checks [{name,status:passed|failed|skipped,evidence}], files (or filesNote), and pr URL (or prNote). Report failed checks and reasons honestly; do not claim success if checks failed. A checklist is reported evidence, not independent verification.' };
    }
  }
  return output;
}
/** The worker submits only its own report, authenticated with its hook token. */
export async function workerCompletion(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const id = url.searchParams.get('worker') ?? '';
  const floor = ctx.workerFloor(id);
  const actor = floor?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (!floor || !actor) return send(res, 401, { error: 'Send your own worker ID and hook token' });
  if (req.method === 'GET' && url.pathname.endsWith('/completion')) return send(res, 200, { revision: actor.completionRevision ?? 0, report: actor.completion ?? null });
  if (req.method !== 'POST' || !url.pathname.endsWith('/complete')) return send(res, 405, { error: 'GET /office/workers/completion or POST /office/workers/complete' });
  let body: unknown; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(res, 400, { error: 'Send JSON' }); }
  const error = floor.workers.submitCompletion(id, body, floor.project.branch);
  return error ? send(res, 400, { error }) : send(res, 200, { revision: actor.completionRevision ?? 0, report: actor.completion });
}
