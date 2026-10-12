import type { KnowledgeTreeView } from '../../../shared/protocol/knowledge';
import type { Slice } from '../store';
declare module '../store' {
  interface Store { knowledge: KnowledgeTreeView; knowledgeNote: { path: string; text: string; handover?: boolean } | null; knowledgeStatus: { message: string; results?: { path: string; title: string; line: number; lines: string[] }[] } }
  interface Topics { knowledge: true; knowledgeNote: true; knowledgeStatus: true }
}
const empty = (): KnowledgeTreeView => ({ branch: '', rows: [], uncommitted: false, handovers: [] });
export const knowledge: Slice = {
  init(s) { s.knowledge = empty(); s.knowledgeNote = null; s.knowledgeStatus = { message: '' }; },
  on: {
    'knowledge/tree'(s, m) { s.knowledge = m.tree; return ['knowledge']; },
    'knowledge/note'(s, m) { s.knowledgeNote = m; return ['knowledgeNote']; },
    'knowledge/status'(s, m) { s.knowledgeStatus = m; return ['knowledgeStatus']; },
  },
  enter(s) { s.knowledge = empty(); s.knowledgeNote = null; return ['knowledge', 'knowledgeNote']; },
};
