import { randomUUID } from 'node:crypto';
import type { BossState, BossSteering } from '../../shared/boss-mode/types.js';
import type { WorkerInfo } from '../../shared/protocol.js';

export function promptDiscovery(state: BossState, workers: {
  get(id: string): Pick<WorkerInfo, 'masterWorkers'> | undefined;
  prompt(id: string, message: string, by: string): string | undefined;
}, id: string, message: string) {
  const role = workers.get(id)?.masterWorkers;
  if (id !== state.discovery?.workerId || role?.role !== 'master' || role.id !== 'boss-discovery-' + state.discovery.id) return 'Not the active Boss discovery participant';
  return workers.prompt(id, message, 'Master / Workers');
}

export function recordSteering(state: BossState, text: string, now: number) {
  for (const item of state.backlog) if (item.status === 'queued') item.status = 'suggested';
  state.nextAt = undefined;
  state.steering.push({ id: randomUUID(), at: now, text, status: 'acknowledged' });
  state.steering = state.steering.slice(-100);
}

export function steeringMessage(state: BossState, instructions: BossSteering[]) {
  return 'USER DIRECTION: Latest explicit user instructions take priority over your selected initiative and inferred improvements. Apply them at the next safe checkpoint. Preserve existing commits and PRs; stop pursuing unrelated pending work and reconcile the task plan. Do not treat the user request as background context.\nCurrent mission: ' + state.config.mission +
    '\nInstructions (oldest to newest; newer instructions supersede conflicting older ones):\n' + instructions.map(s => `${s.id}: ${s.text}`).join('\n') +
    '\nRead office-workers boss state. After applying these instructions report office-workers boss action with JSON stdin: ' + JSON.stringify({ action: 'ack-steering', ids: instructions.map(s => s.id) });
}
