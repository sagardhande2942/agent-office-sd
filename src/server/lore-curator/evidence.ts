import { execFile } from 'node:child_process';
import type { LoreNote } from '../../shared/protocol/lore.js';
const git = (dir: string, args: string[]) => new Promise<string>((resolve, reject) => execFile('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (e, out) => e ? reject(e) : resolve(out)));
export interface RepositoryEvidence { commit?: string; files: { path: string; excerpt: string }[] }
const words = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
const stop = new Set(['this', 'that', 'with', 'from', 'have', 'must', 'when', 'were', 'only', 'note', 'notes', 'test', 'tests', 'server', 'worker', 'workers']);
/** Keep useful context around matching lines rather than dropping everything after the file header. */
function excerpt(text: string, terms: Set<string>): string {
  if (text.length <= 4000) return text;
  const lines = text.split('\n');
  const hits = lines.map((line, i) => ({ i, score: new Set(words(line).filter(w => terms.has(w))).size }))
    .filter(h => h.score).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 3);
  if (!hits.length) return text.slice(0, 4000);
  const selected = new Set<number>();
  for (const h of hits) for (let i = Math.max(0, h.i - 5); i <= Math.min(lines.length - 1, h.i + 7); i++) selected.add(i);
  let out = '', previous = -2;
  for (const i of [...selected].sort((a, b) => a - b)) {
    const chunk = `${i !== previous + 1 ? '…\n' : ''}${i + 1}: ${lines[i]}\n`;
    if (out.length + chunk.length > 4000) break;
    out += chunk; previous = i;
  }
  return out || text.slice(0, 4000);
}
/** Only bounded, committed text is supplied to the model; no shell or checkout access is needed. */
export async function repositoryEvidence(dir: string, notes: LoreNote[]): Promise<RepositoryEvidence> {
  try {
    const commit = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    const paths = (await git(dir, ['ls-tree', '-r', '--name-only', '-z', commit])).split('\0');
    const noteText = notes.map(n => `${n.title} ${n.content} ${n.tags.join(' ')}`).join('\n');
    const terms = new Set(words(noteText).filter(w => !stop.has(w)));
    const files = paths.filter(p => /\.(?:md|ts|tsx|js|mjs|json|py|go|rs|css|yml|yaml)$/.test(p) && !/(?:^|\/)(?:\.env|credentials|secrets?|auth|tokens?|node_modules|vendor)(?:[./_-]|$)|(?:lock|private.?key|password)/i.test(p));
    const ranked = files.map(p => {
      const base = p.split('/').at(-1)!.replace(/\.[^.]+$/, '');
      const score = new Set(words(base).filter(w => terms.has(w))).size * 4
        + new Set(words(p).filter(w => terms.has(w))).size
        + (noteText.includes(p) ? 12 : 0);
      return { p, score, base };
    }).filter(x => x.score > 0 || /^(README\.md|package\.json)$/.test(x.p))
      .sort((a, b) => b.score - a.score || a.base.length - b.base.length || a.p.localeCompare(b.p)).slice(0, 32);
    const candidates = [];
    for (const { p, score } of ranked) {
      const text = await git(dir, ['show', `${commit}:${p}`]);
      if (text.includes('\0') || /(?:BEGIN .*PRIVATE KEY|(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"][^'"\s]{12,})/i.test(text)) continue;
      const matches = new Set(words(text).filter(w => terms.has(w))).size;
      candidates.push({ path: p, excerpt: excerpt(text, terms), score: score + Math.min(matches, 8) });
    }
    // Include implementation and test evidence when available; neither category can crowd out the other.
    candidates.sort((a, b) => b.score - a.score);
    const selected = new Set(candidates.slice(0, 6));
    for (const pattern of [/^(?:src|lib)\//, /(?:^tests?\/|[.-](?:test|spec)\.)/]) {
      const candidate = candidates.find(c => pattern.test(c.path)); if (candidate) selected.add(candidate);
    }
    for (const candidate of candidates) { if (selected.size >= 8) break; selected.add(candidate); }
    return { commit, files: [...selected].map(({ path, excerpt }) => ({ path, excerpt })) };
  } catch { return { files: [] }; }
}
