import { registerWorkerVisual } from '../../../world/character/appearance';
import { heroes } from './heroes';
import { platform } from './platform';
import { creatures } from './creatures';
import type { FictionalCharacter } from '../../../../shared/appearances';
export const fictionalFactories = { ...heroes, ...platform, ...creatures } satisfies Record<FictionalCharacter, () => import('../../../world/character/appearance').WorkerVisual>;
export function registerFictionalCharacters() {
  for (const [id, factory] of Object.entries(fictionalFactories)) registerWorkerVisual(id as FictionalCharacter, factory);
}
