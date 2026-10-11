import { createHash } from 'node:crypto';
import type { LoreNote } from '../../shared/protocol/lore.js';
import type { CurationMeta } from '../../shared/lore-curator.js';
import type { RepositoryEvidence } from './evidence.js';
import type { CuratorMemory } from './memory.js';
export const version = (n: LoreNote) => createHash('sha256').update(JSON.stringify(n)).digest('hex');
interface Action { action: 'merge' | 'archive' | 'verify' | 'flag'; id: string; target: string; reason: string; evidence: string[] }
export function parseActions(body: unknown, notes: LoreNote[], evidence: RepositoryEvidence): { summary: string; actions: Action[] } {
  if (!body || typeof body !== 'object') throw Error('Curator did not return a JSON object');
  const b = body as { summary: unknown; actions: unknown };
  if (typeof b.summary !== 'string' || b.summary.length > 2000 || !Array.isArray(b.actions) || b.actions.length > notes.length) throw Error('Invalid curator response');
  const ids = new Set(notes.map(n => n.id)), used = new Set<string>(), paths = new Set(evidence.files.map(f => f.path));
  const actions: Action[] = [];
  for (const raw of b.actions) {
    const a = raw as Action;
    if (!a || !['merge', 'archive', 'verify', 'flag'].includes(a.action) || !ids.has(a.id) || typeof a.reason !== 'string' || !a.reason.trim() || a.reason.length > 1500 || !Array.isArray(a.evidence) || a.evidence.length > 8 || a.evidence.some(p => typeof p !== 'string' || !paths.has(p)) || typeof a.target !== 'string') throw Error('Invalid curator action or unsupported evidence');
    if (a.action === 'verify' && !a.evidence.length) throw Error('Verification requires supplied repository evidence');
    if (a.action === 'merge' && (!ids.has(a.target) || a.target === a.id)) throw Error('A merge requires two different notes in this batch');
    const affected = a.action === 'merge' ? [a.id, a.target] : [a.id];
    if (affected.some(id => used.has(id))) throw Error('Curator actions overlap; retry with independent actions');
    affected.forEach(id => used.add(id)); actions.push(a);
  }
  return { summary: b.summary, actions };
}
/** Plan the whole journal mutation first, then commit one atomic file before publishing. */
export function applyActions(memory: CuratorMemory, notes: LoreNote[], actions: Action[], evidence: RepositoryEvidence, now: number) {
  const current = new Map(memory.list().map(n => [n.id, n])), snapshots = new Map(notes.map(n => [n.id, n]));
  const records = structuredClone(memory.journal.data.records);
  const changed = new Set<string>(); let skipped = 0;
  const unchanged = (id: string) => current.has(id) && version(current.get(id)!) === version(snapshots.get(id)!);
  const set = (id: string, meta: CurationMeta) => { records[id].meta = meta; changed.add(id); };
  for (const a of actions) {
    const ids = a.action === 'merge' ? [a.id, a.target] : [a.id];
    if (ids.some(id => !unchanged(id))) { skipped++; continue; }
    const reason = `${a.reason}${a.evidence.length ? ` Evidence: ${a.evidence.join(', ')} @ ${evidence.commit ?? 'unknown commit'}` : ''}`;
    if (a.action === 'merge') {
      const source = current.get(a.id)!, target = current.get(a.target)!;
      const identical = source.content.trim().replace(/\r\n/g, '\n') === target.content.trim().replace(/\r\n/g, '\n');
      const content = identical ? target.content : `${target.content}\n\nSource ${source.id} (${source.author}):\n${source.content}`;
      if (content.length > 10000 || source.tags.includes('handover') || target.tags.includes('handover')) { skipped++; continue; }
      records[a.target].content = content;
      set(a.target, { status: 'active', reason, sources: [...new Set([...records[a.target].meta.sources, ...records[a.id].meta.sources])], checkedAt: now });
      set(a.id, { status: 'superseded', reason: `${reason} Consolidated into ${a.target}`, sources: [a.target], checkedAt: now });
    } else set(a.id, { status: a.action === 'verify' ? 'active' : a.action === 'flag' ? 'needs-verification' : 'archived', reason, sources: records[a.id].meta.sources, checkedAt: now });
  }
  for (const note of notes) if (unchanged(note.id)) { records[note.id].processed = records[note.id].fingerprint; records[note.id].reviewedAt = now; }
  const previous = memory.journal.data.records; memory.journal.data.records = records;
  try { memory.journal.save(); } catch (error) { memory.journal.data.records = previous; throw error; }
  return { changed: [...changed].map(id => memory.get(id)!), skipped };
}
