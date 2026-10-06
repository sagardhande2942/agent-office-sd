import type { PlanReviewState } from '../../../shared/plan-review';
import type { Slice } from '../store';
declare module '../store' { interface Store { planReview: PlanReviewState; } interface Topics { planReview: true; } }
export const planReview: Slice = {
  init(s) { s.planReview = { current: null, past: [] }; },
  on: { 'plan-review'(s, m) { s.planReview = m.state; return ['planReview']; } },
  enter(s, v) { s.planReview = v.planReview ?? { current: null, past: [] }; return ['planReview']; },
};
