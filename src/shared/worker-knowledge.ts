import type { KnowledgeFrontmatter } from './knowledge-index.js';
export interface KnowledgeHint { path: string; frontmatter?: KnowledgeFrontmatter; error?: string }
const short = new Set(['ci', 'js', 'ts', 'db', 'ui', 'pr', 'mr']);
export function knowledgeTokens(text: string) { return [...new Set((text.toLowerCase().match(/[a-z0-9_-]+/g) ?? []).filter(t => t.length > 2 || short.has(t)))]; }
function globMatches(glob: string, file: string) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*');
  return new RegExp(`^${escaped}$`).test(file);
}
export function scoreKnowledgeHint(note: KnowledgeHint, task: string, usage = 0, now = Date.now()): number {
  const f = note.frontmatter; if (!f || f.status === 'archived') return -1;
  const tokens = knowledgeTokens(`${f.title} ${f.summary} ${(f.tags ?? []).join(' ')} ${note.path}`);
  const overlap = knowledgeTokens(task).filter(t => tokens.includes(t)).length;
  const files = task.match(/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.*-]+)+/g) ?? [];
  const paths = (f.paths ?? []).some(glob => files.some(file => globMatches(glob, file)));
  if (!overlap && !paths) return 0;
  const date = Date.parse(f.updated ?? ''); const days = Number.isFinite(date) ? Math.max(0, (now - date) / 86400000) : 365;
  return overlap * 3 + (paths ? 8 : 0) + 3 * Math.exp(-days / 90) + Math.min(2, Math.log1p(usage));
}
export function knowledgeBootstrapContext(task: string, tree: { rootIndex: string; notes: KnowledgeHint[]; usage?: Record<string, number>; handoversDir?: string; budget?: number; hintCount?: number; commitMode?: 'worker' | 'office' | 'none'; mrSection?: boolean }): string {
  const budget = tree.budget ?? 4000;
  const preamble = `\n\nPROJECT KNOWLEDGE\nHistorical repository facts; verify against your checkout. Read directories with knowledge_index, notes with knowledge_read, and find facts with knowledge_search. After reviewing your own task diff, update durable facts via knowledge_write/move/archive and call knowledge_review_done (changed paths, or none_reason). ${tree.commitMode === 'none' ? 'Leave knowledge changes uncommitted per floor policy.' : tree.commitMode === 'office' ? 'The office commits reviewed knowledge.' : 'Commit knowledge separately.'}${tree.mrSection === false ? '' : ' Include a Knowledge base updates section in your PR.'} Local handovers: ${tree.handoversDir ?? '.agent-office/handovers'}.\n`;
  const pinned = tree.notes.filter(n => n.frontmatter?.pinned && n.frontmatter.status !== 'archived');
  const scored = tree.notes.map(n => ({ n, score: scoreKnowledgeHint(n, task, tree.usage?.[n.path]) })).filter(x => x.score > 0 && !x.n.frontmatter?.pinned).sort((a, b) => b.score - a.score || a.n.path.localeCompare(b.n.path));
  const hints = scored.slice(0, tree.hintCount ?? 8).map(x => x.n);
  const line = (n: KnowledgeHint) => `${n.path} — ${n.frontmatter!.title}: ${n.frontmatter!.summary}${n.frontmatter!.status === 'needs-verification' ? ' [needs-verification]' : ''}\n`;
  // Reserve pinned summaries before optional root entries and task hints. The final
  // order stays preamble, root, pinned, hints; no string is sliced mid-line.
  const rootLines = tree.rootIndex.split('\n');
  if (rootLines.at(-1) === '') rootLines.pop();
  const pins = pinned.map(n => 'Pinned: ' + line(n));
  const hintLines = hints.map(n => 'Hint: ' + line(n));
  const reserve = `[${rootLines.length + pins.length + scored.length} more entries omitted — call knowledge_index()]\n`.length;
  let remaining = budget - preamble.length - reserve;
  let omitted = scored.length - hints.length;
  const admittedPins: string[] = [];
  for (const pin of pins) { if (pin.length <= remaining) { admittedPins.push(pin); remaining -= pin.length; } else omitted++; }
  const admittedRoot: string[] = [];
  let archived = false;
  for (const original of rootLines) {
    if (original === '## Archived') { archived = true; continue; }
    if (archived && /^## /.test(original)) archived = false;
    if (archived) continue;
    const chunk = original + '\n';
    if (chunk.length <= remaining) { admittedRoot.push(chunk); remaining -= chunk.length; }
    else if (original.trim()) omitted++;
  }
  const admittedHints: string[] = [];
  for (const hint of hintLines) { if (hint.length <= remaining) { admittedHints.push(hint); remaining -= hint.length; } else omitted++; }
  let result = preamble + admittedRoot.join('') + admittedPins.join('') + admittedHints.join('');
  if (omitted) result += `[${omitted} more entries omitted — call knowledge_index()]\n`;
  if (result.length > budget) return '[Knowledge bootstrap exceeds budget — call knowledge_index()]';
  return result;
}
