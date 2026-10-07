import { store } from '../state';
import { isAsleep } from '../../shared/status';
import type { WorkerInfo } from '../../shared/protocol';
/** Opening an active terminal never creates or resumes a worker session. */
export function visitWorker(id: string, actions: { lost: (worker: WorkerInfo) => void; resume: (worker: WorkerInfo) => void; terminal: () => void }) {
  const w = store.workers.get(id);
  if (!w) return;
  if (w.lost) return actions.lost(w);
  if (isAsleep(w.status)) actions.resume(w);
  actions.terminal();
}
