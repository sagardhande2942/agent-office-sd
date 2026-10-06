import type { PlanReviewState, PlanReviewRequest } from '../plan-review.js';
export type PlanReviewClientMsg = { t: 'plan-review.start'; request: PlanReviewRequest } | { t: 'plan-review.stop' } | { t: 'plan-review.retry' };
export type PlanReviewServerMsg = { t: 'plan-review'; state: PlanReviewState };
declare module './floors.js' { interface FloorView { planReview?: PlanReviewState; } }
