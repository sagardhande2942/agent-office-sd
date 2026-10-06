import type { AgentChoice, WorkerInfo } from './protocol.js';
export const PLAN_CRITERIA = [
  {id:'coverage',label:'Requirement coverage',weight:35},
  {id:'feasibility',label:'Correctness and feasibility',weight:25},
  {id:'detail',label:'Implementation detail and sequencing',weight:20},
  {id:'verification',label:'Verification strategy',weight:15},
  {id:'simplicity',label:'Simplicity within scope',weight:5},
] as const;
export type PlanCriterion = typeof PLAN_CRITERIA[number]['id'];
export type PlanWeights = Record<PlanCriterion,number>;
export const DEFAULT_PLAN_WEIGHTS = Object.fromEntries(PLAN_CRITERIA.map(c=>[c.id,c.weight])) as PlanWeights;
export interface PlanReviewRequest {
  brief: string;
  requirements: string[];
  constraints?: string;
  candidates: AgentChoice[];
  reviewer: AgentChoice;
  weights?: PlanWeights;
  minutes?: number;
}
export interface DetailedPlan {
  requirements: {id:string;approach:string;acceptance:string}[];
  findings: {file:string;evidence:string}[];
  design: string;
  steps: {title:string;files:string[];details:string}[];
  verification: {requirement:string;check:string;expected:string}[];
  risks: {risk:string;mitigation:string}[];
  assumptions: {assumption:string;verify:string}[];
  scope: {included:string;excluded:string};
}
export interface PlanRating {
  candidate: string;
  scores: Record<PlanCriterion,number>;
  scoreReasons: Record<PlanCriterion,string>;
  gates: Record<'coverage'|'feasibility'|'detail',{pass:boolean;reason:string}>;
  strengths: string[];
  weaknesses: string[];
  decision: 'accept'|'reject';
  reason: string;
  score: number;
  eligible: boolean;
}
export interface PlanCandidate {
  id: string;
  workerId: string;
  choice: AgentChoice;
  worktree?: WorkerInfo['worktree'];
  plan?: DetailedPlan;
  submittedAt?: number;
  clarification?: string;
  previousPlan?: DetailedPlan;
  clarificationSent?: boolean;
  cleanup?: {done:boolean;error?:string};
}
export interface PlanReviewActivity {
  id:string;
  brief:string;
  requirements:string[];
  constraints:string;
  weights:PlanWeights;
  createdAt:number;
  by:string;
  owner?:string;
  deadline:number;
  reviewDeadline?:number;
  minutes:number;
  revision:number;
  phase:'planning'|'reviewing'|'cleanup'|'implementing'|'done'|'no-winner'|'stopped'|'error';
  requestedCandidates?:AgentChoice[];
  candidates:PlanCandidate[];
  reviewer:{workerId:string;choice:AgentChoice;worktree?:WorkerInfo['worktree'];cleanup?:{done:boolean;error?:string}};
  reviewSent?:boolean;
  clarificationUsed?:boolean;
  review?:{summary:string;winner:string|null;ratings:PlanRating[];at:number};
  error?:string;
  implementationStarted?:boolean;
}
export interface PlanReviewState {current:PlanReviewActivity|null;past:PlanReviewActivity[];error?:string}
export interface PlanReviewWorker {id:string;role:'candidate'|'reviewer';candidate?:string;locked:boolean}
