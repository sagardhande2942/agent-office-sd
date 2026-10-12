/** Research contracts are independent of the office's worker manager and of Discovery. */
export type ResearchRole = 'researcher' | 'reviewer';
export interface ResearchBrief {
  objective: string;
  constraints: string;
  symbols: string[];
  timeframe: string;
  start: string;
  end: string;
  dataset: string;
  maxExperiments: number;
  maxWorkers: number;
  timeoutMinutes: number;
  walkForward: boolean;
}
export interface ResearchAssignment {
  id: string;
  campaign: string;
  role: ResearchRole;
  instructions: string;
  status: 'queued' | 'assigned' | 'submitted' | 'cancelled';
  worker?: string;
  lease?: string;
  experiment?: string;
  error?: string;
}
export interface ResearchExperiment {
  id: string;
  campaign: string;
  assignment: string;
  hypothesis: string;
  hash: string;
  strategy: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'blocked';
  outcome: 'research' | 'rejected' | 'needs-work' | 'reviewed';
  created: number;
  started?: number;
  finished?: number;
  jobId?: number;
  batch?: string;
  metrics?: Record<string, unknown>;
  review?: { summary: string; decision: 'reject' | 'revise' | 'retain'; worker: string };
  error?: string;
  attempts: number;
  localPid?: number;
  cancelRequested?: boolean;
}
export interface ResearchCampaign { id: string; brief: ResearchBrief; paused: boolean; created: number; }
export interface ResearchState {
  campaigns: ResearchCampaign[];
  assignments: ResearchAssignment[];
  experiments: ResearchExperiment[];
  revision: number;
}
export interface ResearchConnection { enabled: boolean; url: string; token: string; scope: string; }
export interface ResearchView { enabled: boolean; url: string; connected: boolean; error?: string; state?: ResearchState; }
export type ResearchAction =
  | { action: 'create'; brief: ResearchBrief; requestId: string }
  | { action: 'pause'; campaign: string; paused: boolean }
  | { action: 'add'; campaign: string; instructions: string; requestId: string }
  | { action: 'assign'; assignment: string; worker: string }
  | { action: 'manual'; assignment: string; hypothesis: string; code: string; config: string }
  | { action: 'release'; assignment: string; lease: string; reason: string }
  | { action: 'submit'; assignment: string; lease: string; worker: string; hypothesis: string; code: string; config: string }
  | { action: 'review'; assignment: string; lease: string; worker: string; summary: string; decision: 'reject' | 'revise' | 'retain' }
  | { action: 'retry' | 'cancel'; experiment: string };
export type ResearchClientMsg = { t: 'research.get' }
  | { t: 'research.configure'; enabled: boolean; url: string; token?: string }
  | { t: 'research.action'; body: ResearchAction }
  | { t: 'research.dispatch'; assignment: string; worker: string };
export type ResearchServerMsg = { t: 'research.state'; floor: string; view: ResearchView };

export const emptyResearch = (): ResearchState => ({ campaigns: [], assignments: [], experiments: [], revision: 0 });
export function researchText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw Error(`${label} must contain 1–${max} characters without control characters`);
  return value.trim();
}
export function researchBrief(input: unknown): ResearchBrief {
  if (!input || typeof input !== 'object') throw Error('Provide a research brief');
  const b = input as ResearchBrief;
  const date = (v: unknown) => typeof v === 'string' && /^\d{8}$/.test(v) && (() => {
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    try { return new Date(iso).toISOString().startsWith(iso); } catch { return false; }
  })();
  if (!date(b.start) || !date(b.end) || b.start >= b.end) throw Error('Use valid YYYYMMDD dates with start before end');
  if (!Array.isArray(b.symbols) || !b.symbols.length || b.symbols.length > 8 || b.symbols.some(s => typeof s !== 'string' || !/^[A-Z0-9_]{1,20}$/.test(s))) throw Error('Provide up to eight symbol identifiers');
  if (!['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].includes(b.timeframe)) throw Error('Unsupported timeframe');
  for (const [key, max] of [['maxExperiments', 100], ['maxWorkers', 8], ['timeoutMinutes', 120]] as const)
    if (!Number.isInteger(b[key]) || b[key] < 1 || b[key] > max) throw Error(`${key} must be 1–${max}`);
  if (typeof b.walkForward !== 'boolean') throw Error('Choose whether to run walk-forward');
  return { objective: researchText(b.objective, 'Objective', 4000), constraints: typeof b.constraints === 'string' ? b.constraints.slice(0, 4000) : '',
    dataset: researchText(b.dataset, 'Dataset version / fingerprint', 240), symbols: [...new Set(b.symbols)], timeframe: b.timeframe,
    start: b.start, end: b.end, maxExperiments: b.maxExperiments, maxWorkers: b.maxWorkers, timeoutMinutes: b.timeoutMinutes, walkForward: b.walkForward };
}
