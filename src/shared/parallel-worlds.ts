import type { AgentChoice, WorkerInfo } from './protocol.js';

export const WORLD_APPROACHES = [
  { name: 'Minimal', brief: 'Prefer the simplest useful implementation, clear controls and minimal dependencies.', color: '#50e3c2' },
  { name: 'Visual', brief: 'Make the result understandable at a glance with thoughtful visual design and interactions.', color: '#77a7ff' },
  { name: 'Experimental', brief: 'Explore an unusual but usable approach. Explain its tradeoffs and keep it maintainable.', color: '#d58bff' },
] as const;

export interface WorldsRequest {
  task: string;
  approaches: { name: string; brief: string }[];
  agent: AgentChoice;
}
export interface ParallelWorld {
  id: string;
  name: string;
  brief: string;
  workerId?: string;
  branch?: string;
  error?: string;
}
export interface WorldsExperiment {
  id: string;
  task: string;
  agent: AgentChoice;
  base: string;
  from: string;
  createdAt: number;
  createdBy: string;
  owner?: string;
  worlds: ParallelWorld[];
  winner?: string;
  archived?: boolean;
}
export interface WorldsState { experiments: WorldsExperiment[]; error?: string }
export interface WorldView extends ParallelWorld {
  worker?: Pick<WorkerInfo, 'name' | 'status' | 'activity' | 'worktree' | 'pr' | 'usage' | 'completion' | 'lost'>;
}
export interface WorldsView extends Omit<WorldsExperiment, 'worlds' | 'owner'> { worlds: WorldView[] }
export interface WorldsResponse { experiments: WorldsView[]; error?: string }

export function worldPrompt(task: string, world: Pick<ParallelWorld, 'name' | 'brief'>, base: string): string {
  return `Parallel universe: ${world.name}\nShared task: ${task}\nYour approach: ${world.brief}\nAll variants start at ${base}. Work only in your assigned worktree and keep its branch. Implement and verify your variant independently. Commit your changes and report checks and tradeoffs in your terminal. For a web app, start a preview server in the background on a free port; keep it running so the office can discover it. Do not open or merge a PR until the human selects this variant. Do not change other variants or the main checkout.`;
}
