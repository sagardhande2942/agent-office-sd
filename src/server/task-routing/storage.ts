import { readFileSync, existsSync } from 'node:fs';
import { atomicWrite } from '../knowledge/store.js';
import type { QueueTask } from './bridge.js';
export interface Attempt { task: QueueTask; claimKey: string; state: 'claiming' | 'starting' | 'running' | 'done' | 'unresolved'; meetingId?: string; failures?: number; nextPoll?: number; result?: unknown; failure?: string; error?: string }
export interface RoutingState { version: 1; attempts: Record<string, Attempt>; error?: string }
export function readRouting(file: string): RoutingState {
  if (!existsSync(file)) return { version: 1, attempts: {} };
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (state.version !== 1 || !state.attempts || Array.isArray(state.attempts)) throw Error('Invalid task routing state; preserve it for recovery');
  for (const a of Object.values(state.attempts) as Attempt[]) {
    if (!a.task?.id || !a.claimKey || !['claiming','starting','running','done','unresolved'].includes(a.state)) throw Error('Invalid task attempt');
  }
  return state;
}
export const saveRouting = (file: string, state: RoutingState) => atomicWrite(file, JSON.stringify(state, null, 2) + '\n');
