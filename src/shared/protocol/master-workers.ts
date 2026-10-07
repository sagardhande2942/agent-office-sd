import type { TeamRequest, TeamState, TeamPreset } from '../master-workers.js';
export type MasterWorkersClientMsg =
  | { t: 'master-workers.start'; request: TeamRequest }
  | { t: 'master-workers.control'; action: 'pause' | 'resume' | 'stop' }
  | { t: 'master-workers.preset'; preset?: TeamPreset; remove?: string };
export type MasterWorkersServerMsg = { t: 'master-workers'; state: TeamState };
export interface TeamRole { id: string; role: 'master' | 'worker'; task?: string; }
declare module './workers.js' { interface WorkerInfo { masterWorkers?: TeamRole; } }
declare module './floors.js' { interface FloorView { masterWorkers?: TeamState; } }
