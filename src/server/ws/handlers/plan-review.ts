import type { PlanReviewClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { here } from './common.js';
export const planReviewView: ViewPieces['planReview'] = (ctx, floor) => ctx.asLocal(floor)?.planReviews.state() ?? { current: null, past: [] };
export const planReviewHandlers = {
  'plan-review.start'(ctx, c, msg) {
    const floor = ctx.asLocal(here(ctx, c));
    if (!floor) { ctx.warn(c, 'Plan comparison requires a local floor'); return; }
    const request = msg.request;
    if (!request || !Array.isArray(request.candidates)) { ctx.warn(c, 'List planning candidates'); return; }
    if ([...request.candidates, request.reviewer].some(a => !a || !floor.project.agentProviders.includes(a.provider))) { ctx.warn(c, 'Select installed agent providers'); return; }
    ctx.withSignIn(c, ctx.claudeFor([...request.candidates, request.reviewer].some(a => a.provider === 'claude') ? 'claude' : 'opencode'), () => ctx.withFreshBase(c, floor, () => ctx.warn(c, floor.planReviews.start(request, c.peer.name, c.accountId))));
  },
  async 'plan-review.stop'(ctx, c) { const floor = ctx.asLocal(here(ctx, c)); if (floor) ctx.warn(c, await floor.planReviews.stop(c.peer.name)); },
  async 'plan-review.retry'(ctx, c) { const floor = ctx.asLocal(here(ctx, c)); if (floor) ctx.warn(c, await floor.planReviews.retryCleanup()); },
} satisfies HandlerMap<PlanReviewClientMsg>;
