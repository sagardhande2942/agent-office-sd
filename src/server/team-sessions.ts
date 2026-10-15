import type { Floor } from './floor.js';
import type { TeamAction, TeamState } from '../shared/master-workers.js';
export interface TeamSession {
  member(id: string): 'master' | 'worker' | undefined;
  state(): TeamState;
  recordResponse?(bytes:number): void;
  action(actor: string, body: TeamAction): Promise<TeamState>;
}
const sessions = new WeakMap<Floor, Set<TeamSession>>();
const observers = new WeakMap<Floor, Set<(state: TeamState) => void>>();
export function observeTeamState(floor: Floor, fn: (state: TeamState) => void) {
  let set = observers.get(floor); if (!set) observers.set(floor, set = new Set());
  set.add(fn); return () => set!.delete(fn);
}
export function notifyTeamState(floor: Floor, state: TeamState) {
  for (const fn of observers.get(floor) ?? []) { try { fn(state); } catch { /* Observers retry without interrupting team actions. */ } }
}
export function registerTeamSession(floor: Floor, session: TeamSession) {
  let set = sessions.get(floor); if (!set) sessions.set(floor, set = new Set());
  set.add(session); return () => set!.delete(session);
}
export function workerTeamSession(floor: Floor, actor: string): TeamSession | undefined {
  return [...(sessions.get(floor) ?? [])].find(s => s.member(actor));
}
