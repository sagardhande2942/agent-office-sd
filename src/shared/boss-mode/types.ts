import type { AgentChoice, WorkerInfo } from '../protocol.js';
import type { TeamRun, TeamState } from '../master-workers.js';
export const BOSS_CATEGORIES = ['features', 'fixes', 'dependencies', 'performance', 'documentation', 'architecture'] as const;
export type BossCategory = typeof BOSS_CATEGORIES[number];
export interface BossConfig {
  mission: string; constraints: string; roadmap: string;
  initiativePolicy: 'roadmap' | 'mission' | 'explore'; categories: BossCategory[];
  boss: AgentChoice; workerMode: 'pool' | 'slots'; models: AgentChoice[]; maxWorkers: number;
  delivery: 'pr' | 'merge'; mergeLabel: string;
  runtimeMinutes: number; dailyStarts: number; recoveryAttempts: number; maxOpenPrs: number; discoveryMinutes: number;
  autoRecover: boolean; checks: string[];
}
export interface BossItem {
  id: string; title: string; problem: string; evidence: string; benefit: string; acceptance: string[];
  category: BossCategory; priority: number; dependencies: string[];
  status: 'suggested' | 'queued' | 'active' | 'delivered' | 'rejected' | 'blocked';
  createdAt: number; startedAt?: number; finishedAt?: number; attempts: number; error?: string;
  pr?: string; merged?: boolean; config?: BossConfig; branch?: string; run?: TeamRun; followup?: string;
}
export interface BossEvent { id: string; at: number; kind: string; message: string; initiative?: string; }
export interface BossSteering { id: string; at: number; text: string; status: 'acknowledged' | 'pending' | 'applied' | 'failed'; appliedAt?: number; }
export interface BossCheck { command: string; commit: string; startedAt: number; finishedAt?: number; exitCode?: number; log: string; }
export type BossPoint = [number, number, number];
export interface BossPresence {
  path: BossPoint[]; startedAt: number; speed: number; face: number;
  activity: string; target?: string; seat?: string; map?: string;
}
export interface BossPreset { id: string; name: string; config: BossConfig; }
export interface BossState {
  /** Transport metadata supplied by the office proxy; not persisted host lifecycle state. */
  connection?: 'connecting' | 'ready' | 'unsupported';
  version: 1; revision: number; config: BossConfig; enabled: boolean; draining: boolean; owner?: string;
  phase: 'off' | 'discovering' | 'planning' | 'working' | 'verifying' | 'waiting' | 'draining' | 'blocked';
  message: string; backlog: BossItem[]; events: BossEvent[]; steering: BossSteering[]; checks: BossCheck[];
  presets: BossPreset[]; presence?: BossPresence; team?: TeamState;
  discovery?: { id: string; workerId?: string; startedAt: number; replied?: boolean };
  active?: string; nextAt?: number; day: string; starts: number; recovery: number;
  updatedAt: number; error?: string;
}
export type BossControl =
  | { action: 'configure'; config: BossConfig }
  | { action: 'on' | 'off' | 'stop-now' }
  | { action: 'steer'; text: string }
  | { action: 'idea'; title: string; problem: string; category: BossCategory }
  | { action: 'prioritize'; id: string; priority: number }
  | { action: 'reject'; id: string }
  | { action: 'preset-save'; name: string; id?: string }
  | { action: 'preset-delete'; id: string };
export type BossWorkerAction =
  | { action: 'propose'; revision: number; items: Pick<BossItem, 'title' | 'problem' | 'evidence' | 'benefit' | 'acceptance' | 'category' | 'priority' | 'dependencies'>[]; summary: string }
  | { action: 'focus'; workerId?: string; activity: string }
  | { action: 'ack-steering'; ids: string[] };
export type BossClientMsg = { t: 'boss.get' } | { t: 'boss.control'; control: BossControl };
export type BossServerMsg = { t: 'boss.state'; floor: string; state: BossState };
declare module '../protocol/floors.js' { interface FloorView { bossMode?: BossState; } }
declare module '../protocol/workers.js' { interface WorkerInfo { bossMode?: { floor: string; role: 'boss' | 'worker' }; } }
export function isBossWorker(w: WorkerInfo) { return !!w.bossMode; }
