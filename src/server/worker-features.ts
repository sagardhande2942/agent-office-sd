import { curatorHostCalls, curatorHostSnapshot } from './lore-curator/host.js';
import type { Floor } from './floor.js';
import type { ServerMsg } from '../shared/protocol.js';
import type { WorkerFeature } from './workers/features.js';
import { workerLore } from './lore/worker.js';
import { LORE_WORKER_TOOLS } from './lore/hooks.js';
import { loreHostCalls, loreHostSnapshot } from './lore/host.js';

export const WORKER_FEATURE_TOOLS = [...LORE_WORKER_TOOLS];
export const workerFeatureHostCalls = { ...loreHostCalls, ...curatorHostCalls };
export const workerFeatureSnapshots = (floor: Floor): ServerMsg[] => [loreHostSnapshot(floor), curatorHostSnapshot(floor)];

/** Features register once per floor, sharing the floor's actual persistent services. */
const FEATURES = [workerLore] as const;
export function floorWorkerFeatures(floor: Floor, publish: (msg: ServerMsg) => void): WorkerFeature[] {
  return [...FEATURES.map(install => install(floor.lore, publish)), floor.curator.feature()];
}
