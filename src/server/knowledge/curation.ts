import fs from 'node:fs';
import { parseKnowledgeNote, type KnowledgeFrontmatter } from '../../shared/knowledge-index.js';
import { KnowledgeStore, rejectCredentials } from './store.js';
import { lintKnowledge } from './lint.js';
export interface CurationInput { path: string; frontmatter: KnowledgeFrontmatter; body: string; version: string; handover?: boolean }
export interface KnowledgeAction { action: 'merge' | 'split' | 'move' | 'archive' | 'flag-needs-verification' | 'verify' | 'rewrite-summary' | 'fix-index' | 'promote-handover'; path: string; target?: string; reason: string; summary?: string; body?: string; title?: string; evidence?: string[]; parts?: { path: string; title: string; summary: string; body: string }[] }
export class OverlappingKnowledgeActions extends Error {}
export function humanVerified(note: CurationInput) { return note.frontmatter.status === 'active' && !!(note.frontmatter.human_verified_by || note.frontmatter.author?.startsWith('human:')); }
export function parseKnowledgeActions(value: unknown, batch: CurationInput[], destinations: string[], evidencePaths: string[] = []): { summary: string; actions: KnowledgeAction[] } {
  if (!value || typeof value !== 'object') throw Error('Expected a curator object');
  const v = value as { summary: string; actions: KnowledgeAction[] };
  if (typeof v.summary !== 'string' || v.summary.length > 2000 || !Array.isArray(v.actions) || v.actions.length > batch.length) throw Error('Invalid curator result');
  const paths = new Map(batch.map(n => [n.path, n])); const allowed = new Set(destinations); const used = new Set<string>();
  for (const action of v.actions) {
    if (!action || !['merge', 'split', 'move', 'archive', 'flag-needs-verification', 'verify', 'rewrite-summary', 'fix-index', 'promote-handover'].includes(action.action) || !paths.has(action.path) || typeof action.reason !== 'string' || !action.reason.trim()) throw Error('Curator action must address an exact supplied path');
    if (Object.keys(action).some(k => !['action', 'path', 'target', 'reason', 'summary', 'body', 'title', 'parts', 'evidence', 'contradiction'].includes(k))) throw Error('Unknown curator action field');
    if (action.action === 'flag-needs-verification' && humanVerified(paths.get(action.path)!) && (!action.evidence?.length || typeof (action as KnowledgeAction & { contradiction?: string }).contradiction !== 'string' || !(action as KnowledgeAction & { contradiction?: string }).contradiction?.trim())) throw Error('Human-verified notes require cited contradictory evidence to propose a downgrade');
    if (paths.get(action.path)!.handover && action.action !== 'promote-handover') throw Error('Handovers are read-only promotion inputs');
    if (!paths.get(action.path)!.handover && action.action === 'promote-handover') throw Error('Promotion needs a handover');
    if (['merge', 'move', 'promote-handover'].includes(action.action) && (typeof action.target !== 'string' || action.target === action.path || !(action.action === 'merge' ? paths.has(action.target) && !paths.get(action.target)!.handover : allowed.has(action.target)))) throw Error('Target is outside supplied paths');
    if (action.action === 'split' && (!Array.isArray(action.parts) || action.parts.length < 2 || action.parts.length > 4 || action.parts.some(p => !allowed.has(p.path) || !p.title || !p.summary || typeof p.body !== 'string'))) throw Error('Split needs 2–4 notes in supplied destination paths');
    if (action.evidence !== undefined && (!Array.isArray(action.evidence) || action.evidence.length > 8 || action.evidence.some(p => !evidencePaths.includes(p)))) throw Error('Evidence must cite supplied repository paths');
    if (action.action === 'verify' && !action.evidence?.length) throw Error('Verification requires supplied repository evidence');
    if (action.reason.length > 1500) throw Error('Reason exceeds 1500 characters');
    if (action.action === 'rewrite-summary' && (typeof action.summary !== 'string' || !action.summary.trim())) throw Error('Summary required');
    if (action.action === 'promote-handover' && (!action.title || !action.summary || typeof action.body !== 'string')) throw Error('Promotion requires title, summary and body');
    const affected = [action.path, ...(action.target ? [action.target] : []), ...(action.parts?.map(p => p.path) ?? [])];
    const overlaps = affected.filter((p, i) => used.has(p) || affected.indexOf(p) !== i);
    if (overlaps.length) throw new OverlappingKnowledgeActions(`Overlapping curator actions: ${[...new Set(overlaps)].join(', ')}. Each source, target and split destination may appear in only one action.`);
    affected.forEach(p => used.add(p)); rejectCredentials(JSON.stringify(action));
  }
  return v;
}
export function applyKnowledgeActions(store: KnowledgeStore, batch: CurationInput[], actions: KnowledgeAction[], commit: string) {
  return store.withLock(() => applyLocked(store, batch, actions, commit));
}
function applyLocked(store: KnowledgeStore, batch: CurationInput[], actions: KnowledgeAction[], commit: string) {
  const snapshots = new Map(batch.map(n => [n.path, n])); const changed: string[] = []; let skipped = 0;
  for (const a of actions) {
    const note = snapshots.get(a.path)!;
    const guard = (n: CurationInput) => n.handover || fs.existsSync(store.resolve(n.path)) && fs.readFileSync(store.resolve(n.path), 'utf8') === n.version;
    // Exact content guards also detect two edits made on the same updated date.
    if (!guard(note) || a.action === 'merge' && !guard(snapshots.get(a.target!)!)) { skipped++; continue; }
    const destinations = a.action === 'split' ? a.parts!.map(p => p.path) : ['move', 'promote-handover'].includes(a.action) ? [a.target!] : [];
    if (destinations.some(p => fs.existsSync(store.resolve(p)))) { skipped++; continue; }
    const write = (p: string, frontmatter: KnowledgeFrontmatter, body: string) => { store.write(p, frontmatter, body, 'curator'); changed.push(p); };
    switch (a.action) {
      case 'archive': store.archive(a.path, a.reason, 'curator'); changed.push(a.path); break;
      case 'flag-needs-verification': write(a.path, { ...note.frontmatter, status: 'needs-verification' }, note.body); break;
      case 'verify': write(a.path, { ...note.frontmatter, status: 'active', verified_at: commit, sources: [...new Set([...(note.frontmatter.sources ?? []), ...(a.evidence ?? []).map(p => `commit ${commit}: ${p}`)])] }, note.body); break;
      case 'rewrite-summary': write(a.path, { ...note.frontmatter, summary: a.summary! }, note.body); break;
      case 'move': store.move(a.path, a.target!); changed.push(a.path, a.target!); break;
      case 'merge': {
        const target = snapshots.get(a.target!)!;
        const identical = target.body.trim() === note.body.trim();
        write(a.target!, { ...target.frontmatter, sources: [...new Set([...(target.frontmatter.sources ?? []), ...(note.frontmatter.sources ?? []), note.path])] }, identical ? target.body : target.body + '\n\n' + note.body);
        store.archive(a.path, `${a.reason}; merged into ${a.target}`, 'curator'); changed.push(a.path); break;
      }
      case 'split':
        for (const p of a.parts!) write(p.path, { ...note.frontmatter, title: p.title, summary: p.summary, sources: [...(note.frontmatter.sources ?? []), note.path] }, p.body);
        store.archive(a.path, a.reason, 'curator'); changed.push(a.path); break;
      case 'promote-handover': write(a.target!, { title: a.title!, summary: a.summary!, sources: [note.path], status: 'needs-verification' }, a.body!); break;
      case 'fix-index': changed.push(...lintKnowledge(store, true).fixed); break;
    }
  }
  return { changed: [...new Set(changed)], skipped };
}
export function curationBatch(store: KnowledgeStore, maxNotes: number): CurationInput[] {
  return store.tree().filter(n => n.frontmatter && n.frontmatter.status !== 'archived').slice(0, maxNotes).map(n => {
    const version = fs.readFileSync(store.resolve(n.path), 'utf8'); rejectCredentials(version); const parsed = parseKnowledgeNote(version);
    return { path: n.path, ...parsed, version };
  });
}
