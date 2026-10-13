import type { KnowledgeFrontmatter } from '../knowledge-index.js';
export interface KnowledgeTreeRow { path: string; summary: string; title: string; status: string; tags: string[]; error?: string; directory?: boolean }
export interface KnowledgeDeliveryView { id: string; state: string; url?: string; conflicts?: string[]; error?: string }
export interface KnowledgeTreeView { deliveries?: KnowledgeDeliveryView[]; branch: string; rows: KnowledgeTreeRow[]; uncommitted: boolean; handovers: { path: string; title: string }[] }
export type KnowledgeClientMsg =
  | { t: 'knowledge.tree' }
  | { t: 'knowledge.read'; path: string; handover?: boolean }
  | { t: 'knowledge.search'; query: string }
  | { t: 'knowledge.write'; path: string; frontmatter: Partial<KnowledgeFrontmatter>; body: string; expectedVersion?: string | null }
  | { t: 'knowledge.sync' }
  | { t: 'knowledge.commit'; title: string }
  | { t: 'knowledge.history'; path: string }
  | { t: 'knowledge.restore'; commit: string }
  | { t: 'knowledge.delete'; path: string; expectedVersion?: string | null };
export type KnowledgeServerMsg =
  | { t: 'knowledge/tree'; tree: KnowledgeTreeView }
  | { t: 'knowledge/note'; path: string; text: string; version?: string; handover?: boolean }
  | { t: 'knowledge/status'; message: string; results?: { path: string; title: string; line: number; lines: string[] }[] };
