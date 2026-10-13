import type { Ledger } from './usage.js';
import type { WorkerFeature } from './workers/features.js';
export function providerSpendFeature(ledger: Ledger, floor: string): WorkerFeature {
  const observe: NonNullable<WorkerFeature['update']> = worker => {
    if (worker.kind !== 'agent' || !worker.usage || !worker.sessionId || !['codex', 'opencode', 'dsh'].includes(worker.provider ?? '')) return;
    ledger.observeProvider(worker.provider!, JSON.stringify([floor, worker.sessionId]), worker.usage);
  };
  return { update: observe, remove: observe };
}
