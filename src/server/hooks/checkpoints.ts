import { providerAdapter } from '../providers/index.js';
import { CommunicationCheckpoints } from '../communication-checkpoints.js';
import { normalizeCodexHook } from '../codex.js';
import { communicationsView } from '../ws/handlers/communications.js';
import type { Ctx } from '../office/context.js';
const checkpoints = new WeakMap<Ctx, CommunicationCheckpoints>();
export function checkpointOutput(ctx: Ctx, workerId: string, token: string, route: string, event: string, payload: unknown): Record<string, unknown> {
  const floor = ctx.workerFloor(workerId);
  const actor = floor?.workers.authenticate(workerId, token);
  if (!floor || !actor || actor.planReview?.locked || actor.helperReport?.state === 'interrupting') return {};
  const adapter = providerAdapter(actor.provider);
  if (!adapter || (adapter.hooksAs ?? adapter.id) !== route) return {};
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const root = !data.agent_id && !data.agent_type && (!data.session_id || !actor.sessionId || data.session_id === actor.sessionId || event === 'SessionStart');
  if (!root || (route === 'codex' && (actor.provider !== 'codex' || !normalizeCodexHook(event, payload)))) return {};
  if (!['claude', 'codex', 'opencode'].includes(route)) return {};
  if (route === 'opencode' && (data.type !== 'checkpoint' || data.sessionId !== actor.sessionId)) return {};
  let notices = checkpoints.get(ctx); if (!notices) checkpoints.set(ctx, notices = new CommunicationCheckpoints());
  return notices.output(workerId, route === 'opencode' ? 'PostToolUse' : event, communicationsView(ctx, floor) ?? { messages: [] }, data.stop_hook_active === true);
}
