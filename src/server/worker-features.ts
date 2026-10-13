import { knowledgeHostCalls } from './knowledge/host.js';
import { loadKnowledgeConfig } from './knowledge/settings.js';
import { KNOWLEDGE_WORKER_TOOLS } from './knowledge/hooks.js';
import { workerKnowledge } from './knowledge/worker.js';
import { installKnowledgeAutoSync, closeKnowledgeAutoSync } from './knowledge/auto-sync.js';
import { workerRoles } from './worker-roles/service.js';
import { installFloorBoss, closeFloorBoss } from './boss-mode/service.js';
import { bossHostCalls, bossHostSnapshot } from './boss-mode/host.js';
import { curatorHostCalls, curatorHostSnapshot } from './lore-curator/host.js';
import type { FloorContext, Floor } from './floor.js';
import type { ServerMsg } from '../shared/protocol.js';
import type { WorkerFeature } from './workers/features.js';
import { workerLore } from './lore/worker.js';
import { providerSpendFeature } from './provider-spend-feature.js';
import { LORE_WORKER_TOOLS } from './lore/hooks.js';
import { loreHostCalls, loreHostSnapshot } from './lore/host.js';

export const WORKER_FEATURE_TOOLS = [...KNOWLEDGE_WORKER_TOOLS, ...LORE_WORKER_TOOLS, { name: 'boss_state', readOnly: true } as const, { name: 'boss_action', readOnly: false } as const];
export const workerFeatureHostCalls = { ...knowledgeHostCalls, ...loreHostCalls, ...curatorHostCalls, ...bossHostCalls };
export const workerFeatureSnapshots = (floor: Floor): ServerMsg[] => [loreHostSnapshot(floor), curatorHostSnapshot(floor), bossHostSnapshot(floor)];

/** Features register once per floor, sharing the floor's actual persistent services. */
const FEATURES = [workerLore] as const;
export function floorWorkerFeatures(floor: Floor, publish: (msg: ServerMsg) => void, context: FloorContext): WorkerFeature[] {
  installFloorBoss(floor, context, publish);
  installKnowledgeAutoSync(floor, publish);
  return [providerSpendFeature(context.ledger, floor.def.id), workerKnowledge(floor), ...(loadKnowledgeConfig(floor.def.dir).legacyLore ? FEATURES.map(install => install(floor.lore, publish)) : []), floor.curator.feature(), workerRoles(floor.dir)];
}

export function closeFloorWorkerFeatures(floor: Floor) { closeFloorBoss(floor); closeKnowledgeAutoSync(floor); }
