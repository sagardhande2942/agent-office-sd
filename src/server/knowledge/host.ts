import type { Floor } from '../floor.js';
import type { KnowledgeClientMsg } from '../../shared/protocol/knowledge.js';
import { LocalKnowledge } from './surface.js';
export const knowledgeHostCalls: Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> = {
  'knowledge.execute': (floor: Floor, msg: Record<string, unknown>) => new LocalKnowledge(floor.def.dir).execute(msg.action as KnowledgeClientMsg, String(msg.author ?? 'Anonymous')),
};
