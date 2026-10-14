import type { WorkerInfo } from '../../shared/protocol.js';
/** A physical chair may host one worker per independent meeting, never two in the same meeting. */
export function meetingSeatOccupied(workers: Iterable<{ info: WorkerInfo }>, deskId: string, meeting?: string): boolean {
  for (const { info } of workers) if (info.deskId === deskId && (!meeting || !info.meeting || info.meeting === meeting)) return true;
  return false;
}
