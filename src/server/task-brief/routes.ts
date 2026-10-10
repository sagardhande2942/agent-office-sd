import { BRIEF_AI_PROVIDERS, readBriefRequest, type BriefAiProvider, type BriefAiOption } from '../../shared/task-brief-ai.js';
import { providerCommand } from '../agents.js';
import { childEnv } from '../workers/env.js';
import { resolveCommand } from '../workers/process.js';
import type { Ctx } from '../office/context.js';
import type { Route } from '../http/router.js';
import { readBody, sameOrigin, send } from '../http/util.js';
import { generateDraft } from './draft.js';

const active = new WeakMap<Ctx, Set<string>>();
const command = (ctx: Ctx, provider: BriefAiProvider) => resolveCommand(providerCommand(provider, ctx.cfg.agentCmd));
function option(ctx: Ctx, provider: BriefAiProvider, account?: string): BriefAiOption {
  const name = provider === 'claude' ? 'Claude Code' : 'Codex';
  const reason = !command(ctx, provider) ? `${name} is not installed on the office server.`
    : provider === 'claude' && account && !ctx.signins.ready(account, 'claude') ? ctx.signins.why('claude') : undefined;
  return { id: provider, name, available: !reason, ...(reason ? { reason } : {}) };
}

export const taskBriefRoutes = {
  options: { auth: 'session', method: 'GET', path: '/api/task-brief/options',
    handle(ctx, { res, session }) { return send(res, 200, { providers: BRIEF_AI_PROVIDERS.map(p => option(ctx, p, session.account?.id)) }); },
  },
  draft: { auth: 'session', method: 'POST', path: '/api/task-brief/draft',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Open this from the office page.' });
      let request;
      try { request = readBriefRequest(JSON.parse(await readBody(req, 256_000))); } catch { /* invalid body */ }
      if (!request) return send(res, 400, { error: 'Provide a request, supported provider and valid brief length.' });
      const available = option(ctx, request.provider, session.account?.id);
      if (!available.available) return send(res, 503, { error: available.reason });
      if (ctx.ledger.hiringPaused) return send(res, 429, { error: ctx.ledger.hiringPaused });
      const running = active.get(ctx) ?? new Set<string>(); active.set(ctx, running);
      const key = session.account?.id ?? 'shared';
      if (running.has(key) || running.size >= 2) return send(res, 429, { error: 'AI drafting is already running. Wait or continue manually.' });
      running.add(key);
      const controller = new AbortController(), cancel = () => controller.abort();
      res.once('close', cancel); req.once('aborted', cancel);
      try {
        const env = childEnv();
        if (request.provider === 'claude' && session.account) ctx.signins.apply(session.account.id, env, [], 'claude');
        const brief = await generateDraft(request, { file: command(ctx, request.provider)!, env, signal: controller.signal, onUsage: u => ctx.ledger.add(u) });
        if (!res.destroyed) return send(res, 200, { brief });
      } catch (error) {
        if (!res.destroyed) return send(res, 502, { error: error instanceof Error ? error.message : 'AI drafting failed. Continue manually.' });
      } finally { running.delete(key); res.off('close', cancel); req.off('aborted', cancel); }
    },
  },
} satisfies Record<string, Route>;
