import { execFile } from 'node:child_process';
import type { LoreNote } from '../../shared/protocol/lore.js';
const git = (dir: string, args: string[]) => new Promise<string>((resolve, reject) => execFile('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (e, out) => e ? reject(e) : resolve(out)));
export interface RepositoryEvidence { commit?: string; files: { path: string; excerpt: string; truncated?: boolean }[] }
const MAX_FILES = 24, MAX_TEXT = 96000, FILE_TEXT = 8000;
const words = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
const stop = new Set(['this', 'that', 'with', 'from', 'have', 'must', 'when', 'were', 'only', 'note', 'notes', 'test', 'tests', 'server', 'worker', 'workers']);
/** Keep useful context around matching lines rather than dropping everything after the file header. */
function excerpt(text: string, terms: Set<string>): string {
  if (text.length <= FILE_TEXT) return text;
  const lines = text.split('\n');
  const hits = lines.map((line, i) => ({ i, score: new Set(words(line).filter(w => terms.has(w))).size }))
    .filter(h => h.score).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 12);
  if (!hits.length) return text.slice(0, FILE_TEXT);
  const selected = new Set<number>();
  for (const h of hits) for (let i = Math.max(0, h.i - 10); i <= Math.min(lines.length - 1, h.i + 15); i++) selected.add(i);
  let out = '', previous = -2;
  for (const i of [...selected].sort((a, b) => a - b)) {
    const chunk = `${i !== previous + 1 ? '…\n' : ''}${i + 1}: ${lines[i]}\n`;
    if (out.length + chunk.length > FILE_TEXT) break;
    out += chunk; previous = i;
  }
  return out || text.slice(0, FILE_TEXT);
}
/** Only bounded, committed text is supplied to the model; no shell or checkout access is needed. */
export async function repositoryEvidence(dir: string, notes: LoreNote[]): Promise<RepositoryEvidence> {
  try {
    const commit = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    const paths = (await git(dir, ['ls-tree', '-r', '--name-only', '-z', commit])).split('\0');
    const noteText = notes.map(n => `${n.title} ${n.content} ${n.tags.join(' ')}`).join('\n');
    const terms = new Set(words(noteText).filter(w => !stop.has(w)));
    const files = paths.filter(p => /\.(?:md|ts|tsx|js|mjs|json|py|go|rs|css|yml|yaml)$/.test(p) && !/(?:^|\/)(?:\.env|credentials|secrets?|auth|tokens?|node_modules|vendor)(?:[./_-]|$)|(?:lock|private.?key|password)/i.test(p));
    // Rank each note separately: batch-wide keyword totals let verbose notes
    // crowd out the implementation explicitly referenced by other discoveries.
    const ranks = notes.map(note => {
      const text = `${note.title} ${note.content} ${note.tags.join(' ')}`.replace(/\\/g, '/');
      const ownTerms = new Set(words(text).filter(w => !stop.has(w)));
      return files.map(p => {
        const base = p.split('/').at(-1)!.replace(/\.[^.]+$/, '');
        const score = new Set(words(base).filter(w => ownTerms.has(w))).size * 4
          + new Set(words(p).filter(w => ownTerms.has(w))).size
          + (text.includes(p) ? 100 : 0);
        return { p, score, base };
      }).filter(x => x.score > 0 || /^(README\.md|package\.json)$/.test(x.p))
        .sort((a, b) => b.score - a.score || a.base.length - b.base.length || a.p.localeCompare(b.p));
    });
    const ranked = new Map<string, { p: string; score: number }>();
    for (let i = 0; i < 4; i++) for (const rank of ranks) {
      const candidate = rank[i];
      if (candidate && ranked.size < 64) ranked.set(candidate.p, candidate);
    }
    // Direct citations take precedence, then give every note a first match before
    // spending remaining slots on additional context and implementation/tests.
    const preferred = new Set<string>();
    for (let i = 0; i < 4; i++) for (const rank of ranks) {
      if (rank[i]?.score >= 100) preferred.add(rank[i].p);
    }
    for (const rank of ranks) if (rank[0]) preferred.add(rank[0].p);
    const candidates: (RepositoryEvidence['files'][number] & { score: number })[] = [];
    for (const { p, score } of ranked.values()) {
      // An oversized or unreadable candidate must not discard every other file.
      let text: string;
      try { text = await git(dir, ['show', `${commit}:${p}`]); } catch { continue; }
      if (text.includes('\0') || /(?:BEGIN .*PRIVATE KEY|(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"][^'"\s]{12,})/i.test(text)) continue;
      const matches = new Set(words(text).filter(w => terms.has(w))).size;
      const context = excerpt(text, terms);
      candidates.push({ path: p, excerpt: context, ...(context !== text ? { truncated: true } : {}), score: score + Math.min(matches, 8) });
    }
    // Include implementation and test evidence when available; neither category can crowd out the other.
    candidates.sort((a, b) => b.score - a.score);
    const selected = new Set<typeof candidates[number]>();
    let size = 0;
    const add = (candidate: typeof candidates[number] | undefined) => {
      if (!candidate || selected.has(candidate) || selected.size >= MAX_FILES || size + candidate.excerpt.length > MAX_TEXT) return;
      selected.add(candidate); size += candidate.excerpt.length;
    };
    for (const p of preferred) add(candidates.find(c => c.path === p));
    for (const pattern of [/^(?:src|lib)\//, /(?:^tests?\/|[.-](?:test|spec)\.)/]) {
      add(candidates.find(c => pattern.test(c.path)));
    }
    for (const candidate of candidates) add(candidate);
    return { commit, files: [...selected].map(({ score: _score, ...file }) => file) };
  } catch { return { files: [] }; }
}
