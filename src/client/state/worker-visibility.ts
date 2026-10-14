import type { WorkerInfo } from '../../shared/protocol';
import type { Store } from './store';
/** Features can hide a worker's scene/seat projection without removing it from the live roster. */
export const WORKER_VISIBILITY: ((worker: WorkerInfo, state: Store) => boolean)[] = [];
export function workerVisible(worker: WorkerInfo, state: Store): boolean {
  return WORKER_VISIBILITY.every(test => test(worker, state));
}
