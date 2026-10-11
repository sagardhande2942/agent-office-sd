import { execFile } from 'node:child_process';
import type { LoreNote } from '../../shared/protocol/lore.js';
const git = (dir: string, args: string[]) => new Promise<string>((resolve, reject) => execFile('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (e, out) => e ? reject(e) : resolve(out)));
export interface RepositoryEvidence { commit?: string; files: { path: string; excerpt: string }[] }
/** Only bounded, committed text is supplied to the model; no shell or checkout access is needed. */
export async function repositoryEvidence(dir: string, notes: LoreNote[]): Promise<RepositoryEvidence> {
  try {
    const commit = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    const paths = (await git(dir, ['ls-tree', '-r', '--name-only', '-z', commit])).split('\0');
    const terms = new Set(notes.flatMap(n => `${n.title} ${n.content} ${n.tags.join(' ')}`.toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? []));
    const files = paths.filter(p => /\.(?:md|ts|tsx|js|mjs|json|py|go|rs|css|yml|yaml)$/.test(p) && !/(?:^|\/)(?:\.env|credentials|secrets?|auth|tokens?|node_modules|vendor)(?:[./_-]|$)|(?:lock|private.?key|password)/i.test(p));
    const ranked = files.map(p => ({ p, score: p.toLowerCase().split(/[\W_]+/).reduce((n, w) => n + Number(terms.has(w)), 0) }))
      .filter(x => x.score > 0 || /^(README\.md|package\.json)$/.test(x.p)).sort((a, b) => b.score - a.score).slice(0, 8);
    const evidence: RepositoryEvidence = { commit, files: [] };
    for (const { p } of ranked) {
      const text = await git(dir, ['show', `${commit}:${p}`]);
      if (text.includes('\0') || /(?:BEGIN .*PRIVATE KEY|(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"][^'"\s]{12,})/i.test(text)) continue;
      evidence.files.push({ path: p, excerpt: text.slice(0, 4000) });
    }
    return evidence;
  } catch { return { files: [] }; }
}
