import type { AgentChoice, Usage } from './protocol.js';
import type { ReplayLog } from './task-replay.js';
export interface TeamConfig { master: AgentChoice; models: AgentChoice[]; maxWorkers: number; }
export interface TeamPreset extends TeamConfig { id: string; name: string; }
export interface TeamRequest extends TeamConfig { brief: string; requirements: string[]; constraints?: string; }
export interface TeamAttempt {
  workerId: string; choice: AgentChoice; base: string;
  status: 'running' | 'submitted' | 'failed' | 'rejected' | 'accepted';
  notice?: string; summary?: string; commits?: string[]; checks?: string; review?: string; usage?: Usage;
}
export interface TeamTask {
  id: string; title: string; instructions: string; acceptance: string;
  files: string[]; dependencies: string[];
  status: 'pending' | 'running' | 'review' | 'takeover' | 'done';
  attempts: TeamAttempt[]; reason?: string; evidence?: string; integrated?: string[];
}
export interface TeamParticipant { workerId: string; choice: AgentChoice; usage?: Usage; }
export interface TeamRun extends TeamRequest {
  replay?: ReplayLog;
  id: string; owner?: string; createdAt: number; revision: number;
  phase: 'starting' | 'running' | 'paused' | 'stopped' | 'done';
  masterId?: string; masterWorktree?: { path: string; branch: string };
  workers: TeamParticipant[]; tasks: TeamTask[]; plan?: string; error?: string;
  pr?: string; summary?: string; checks?: string; masterUsage?: Usage;
  notifications: Record<string, string>;
}
export interface TeamState { current: TeamRun | null; past: TeamRun[]; presets: TeamPreset[]; error?: string; }
export type TeamAction =
  | { action: 'plan'; id: string; revision: number; plan: string; tasks: Pick<TeamTask, 'id' | 'title' | 'instructions' | 'acceptance' | 'files' | 'dependencies'>[] }
  | { action: 'dispatch'; id: string; revision: number; task: string; choice: AgentChoice; reason: string }
  | { action: 'result'; id: string; revision: number; task: string; summary: string; commits: string[]; checks: string; failed?: boolean }
  | { action: 'cancel'; id: string; revision: number; task: string; evidence: string }
  | { action: 'review'; id: string; revision: number; task: string; accept: boolean; evidence: string }
  | { action: 'takeover'; id: string; revision: number; task: string; evidence: string; complete?: boolean }
  | { action: 'finish'; id: string; revision: number; pr: string; summary: string; checks: string };
