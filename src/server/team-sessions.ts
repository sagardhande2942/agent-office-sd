import type { Floor } from './floor.js';
import type { TeamAction, TeamState } from '../shared/master-workers.js';
export interface TeamSession {
  member(id: string): 'master' | 'worker' | undefined;
  state(): TeamState;
  action(actor: string, body: TeamAction): Promise<TeamState>;
}
const sessions = new WeakMap<Floor, Set<TeamSession>>();
export function registerTeamSession(floor: Floor, session: TeamSession) {
  let set = sessions.get(floor); if (!set) sessions.set(floor, set = new Set());
  set.add(session); return () => set!.delete(session);
}
export function workerTeamSession(floor: Floor, actor: string): TeamSession | undefined {
  return [...(sessions.get(floor) ?? [])].find(s => s.member(actor));
}
