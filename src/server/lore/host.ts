import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';

export const loreHostSnapshot = (floor: Floor): ServerMsg => ({ t: 'lore.all', notes: floor.lore.list() });
export const loreHostCalls: Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> = {
  'lore.list': floor => floor.lore.list(),
  'lore.save': (floor, msg) => {
    const draft = msg.note as Parameters<Floor['lore']['save']>[0];
    if (!draft || typeof draft.title !== 'string' || !draft.title.trim() || typeof draft.content !== 'string' || !draft.content.trim()) throw new Error('Lore notes require a title and content');
    return floor.lore.save(draft);
  },
  'lore.delete': (floor, msg) => typeof msg.id === 'string' && floor.lore.delete(msg.id),
};
