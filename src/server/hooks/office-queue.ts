import { validateWorkerModel, validateWorkerEffort } from '../agents.js';
import { isAgentProvider, type AgentProvider, type AgentEffort } from '../../shared/protocol.js';
import type http from 'node:http';
import { DESK_BY_ID } from '../../shared/layout.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';

/**
 * The task queue, for the board agents (see stations.ts, which tells them how): GET lists it, POST
 * adds a task, DELETE with ?task= takes a waiting one off. The agent's own hook token says who's asking.
 */
export async function officeQueue(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const agent = floor?.workers.authenticate(workerId, token);
  if (!floor || !agent) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  if (!DESK_BY_ID.get(agent.deskId)?.station) return send(res, 403, { error: 'Only the agents standing by the boards can use the queue' });
  const view = () => {
    const q = floor.queue.state();
    return {
      maxWorkers: q.maxWorkers,
      tasks: q.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, outcome: t.outcome, issue: t.issue, addedBy: t.addedBy, worker: t.workerName, branch: t.branch, pr: t.pr, error: t.error, agent: { provider: t.provider, model: t.model, effort: t.effort }, dependsOn: t.dependsOn })),
    };
  };
  if (req.method === 'GET') return send(res, 200, view());
  if (req.method === 'DELETE') {
    const err = await floor.queue.remove(url.searchParams.get('task') ?? '');
    return err ? send(res, 400, { error: err }) : send(res, 200, view());
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET, POST or DELETE' });
  let body: { prompt?: unknown; title?: unknown; issue?: unknown; provider?: unknown; model?: unknown; effort?: unknown; depends?: unknown; retry?: unknown };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Send JSON: {"title": "…", "prompt": "…", "issue": 12}' });
  }
  // A finished task put back on the queue (office-queue retry), keeping the agent it was queued with.
  if (body?.retry) {
    const err = floor.queue.retry(url.searchParams.get('task') ?? '');
    if (err) return send(res, 400, { error: err });
    const task = floor.queue.state().tasks.find((t) => t.id === url.searchParams.get('task'))!;
    ctx.toastFloor(floor, `📋 The ${agent.name} requeued ${task.issue !== undefined ? `issue #${task.issue}` : `“${task.title}”`}`);
    return send(res, 200, { ok: true, task: { id: task.id, title: task.title, status: task.status } });
  }
  const issue = Number.isInteger(body?.issue) && (body.issue as number) > 0 ? (body.issue as number) : undefined;
  // Which agent the task should start on, refused here before the queue sees it.
  const provider = typeof body?.provider === 'string' && body.provider.trim() ? (body.provider.trim() as AgentProvider) : undefined;
  if (body?.provider !== undefined && !isAgentProvider(provider)) return send(res, 400, { error: 'Unknown agent provider' });
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
  const modelError = validateWorkerModel('agent', provider, model);
  if (modelError) return send(res, 400, { error: modelError });
  const effort = body?.effort;
  const effortError = validateWorkerEffort('agent', provider, effort);
  if (effortError) return send(res, 400, { error: effortError });
  // Tasks it waits on, which have to be on the queue already.
  const depends = Array.isArray(body?.depends) ? body.depends.filter((d): d is string => typeof d === 'string' && !!d.trim()).map((d) => d.trim()) : undefined;
  // Its tasks run as whoever the board agent runs as.
  const err = floor.queue.add(str(body?.prompt, 20000), agent.name, str(body?.title, 200) || undefined, issue, provider, model, effort as AgentEffort | undefined, await floor.workers.ownerOf(agent.id), depends);
  if (err) return send(res, 400, { error: err });
  const task = floor.queue.state().tasks.at(-1)!;
  ctx.toastFloor(floor, `📋 The ${agent.name} queued ${issue !== undefined ? `issue #${issue}` : `“${task.title}”`}`);
  send(res, 200, { ok: true, task: { id: task.id, title: task.title, status: task.status } });
}
