import type { WorldsView } from '../../../shared/parallel-worlds';
import type { WorkerInfo } from '../../../shared/protocol';
import { isBusy } from '../../../shared/status';

/** Gates belong to the current experiment, and follow live worker updates. */
export function runningWorlds(experiments: WorldsView[], workers: ReadonlyMap<string, WorkerInfo>): boolean {
  const current = experiments.find(experiment => !experiment.archived);
  return !!current?.worlds.some(world => {
    const worker = world.workerId ? workers.get(world.workerId) : undefined;
    return !!worker && !worker.lost && isBusy(worker.status);
  });
}
