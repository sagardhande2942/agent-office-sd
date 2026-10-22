/** Routed desk tasks share the existing scoped, output-bound Knowledge contract. */
import type { Meeting, WorkerInfo } from '../../shared/protocol.js';
const sources = new WeakMap<object, () => Meeting[]>();
export function registerWorkerTasks(floor: object, list: () => Meeting[]) { sources.set(floor, list); }
export function unregisterWorkerTasks(floor: object) { sources.delete(floor); }
export function workerTaskFor(floor: object, worker: WorkerInfo): Meeting | undefined {
  return sources.get(floor)?.().find(m => m.status === 'running' && m.workflow?.memory && m.seats.some(s => s.workerId === worker.id));
}
