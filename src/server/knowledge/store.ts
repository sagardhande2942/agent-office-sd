import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseFrontmatter, parseKnowledgeIndex, parseKnowledgeNote, serializeFrontmatter, serializeKnowledgeIndex, type KnowledgeEntry, type KnowledgeFrontmatter } from '../../shared/knowledge-index.js';
export interface KnowledgeConfig {
  dir: string; bootstrapBudgetChars: number; hintCount: number; reviewPolicy: 'required' | 'prompt' | 'off';
  commitMode: 'worker' | 'office' | 'none'; mrSection: boolean; maxNoteBytes: number; searchMaxHits: number; handoversDir: string; legacyLore: boolean;
}
export const KNOWLEDGE_DEFAULTS: KnowledgeConfig = { dir: '.agent-office/knowledge', bootstrapBudgetChars: 4000, hintCount: 8, reviewPolicy: 'required', commitMode: 'none', mrSection: true, maxNoteBytes: 65536, searchMaxHits: 40, handoversDir: '.agent-office/handovers', legacyLore: false };
export const credentialPattern = /(?:BEGIN .*PRIVATE KEY|(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"]?[^'"\s]{12,}|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b)/i;
export function rejectCredentials(text: string) { if (text.split('\n').some(line => credentialPattern.test(line))) throw Error('Knowledge cannot contain credentials; remove the matching line'); }
export interface TreeNote { path: string; frontmatter?: KnowledgeFrontmatter; error?: string }
export function atomicWrite(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export class KnowledgeStore {
  readonly root: string;
  readonly config: KnowledgeConfig;
  constructor(readonly checkout: string, config: Partial<KnowledgeConfig> = {}) {
    this.config = { ...KNOWLEDGE_DEFAULTS, ...config };
    this.root = path.resolve(checkout, this.config.dir);
    if (!this.root.startsWith(path.resolve(checkout) + path.sep)) throw Error('knowledge.dir must be within the checkout');
    this.validateParents(this.root);
  }
  private validateParents(file: string) {
    let cursor = path.resolve(this.checkout);
    const relative = path.relative(cursor, file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw Error('Knowledge paths must stay within the checkout');
    for (const part of ['', ...relative.split(path.sep)]) {
      if (part) cursor = path.join(cursor, part);
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Knowledge paths cannot use symlinks'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
  }
  resolve(relative: string, write = false) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(s => s === '..' || s === '.') || path.isAbsolute(relative)) throw Error('Use a relative knowledge path');
    const file = path.resolve(this.root, relative);
    if (!file.startsWith(this.root + path.sep) || !relative.endsWith('.md')) throw Error('Knowledge paths must stay inside the tree and end in .md');
    if (relative.split('/').some(s => !/^[a-zA-Z0-9_. -]+$/.test(s) || !s.trim())) throw Error('Use plain file and directory names');
    if (relative.split('/').includes('_meta')) throw Error('_meta is private state, not worker knowledge');
    if (write && path.basename(file) === 'INDEX.md') throw Error('Indexes are maintained from child frontmatter');
    this.validateParents(file);
    return file;
  }
  private indexSeed(dir: string, summary = `Knowledge about ${dir || 'this project'}.`) {
    const text = serializeFrontmatter({ kind: 'index', summary }, `# ${dir || 'Knowledge'}\n\n${dir ? '' : 'Write for a stranger. Include commands verbatim. Use one topic per file; operational build, run and test notes are welcome. Split files beyond about 200 lines and directories beyond about 40 entries. Never paste secrets.\n'}\n## Entries\n`);
    return serializeKnowledgeIndex(parseKnowledgeIndex(text));
  }
  seed() {
    if (fs.existsSync(path.join(this.root, 'INDEX.md'))) { this.validateParents(path.join(this.root, 'INDEX.md')); return; }
    if (fs.existsSync(this.root) && fs.readdirSync(this.root).length) throw Error('Knowledge root is missing INDEX.md; run lint repair after restoring the root index');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(this.root, 'INDEX.md'), this.indexSeed(''));
    atomicWrite(path.join(this.root, '_meta/config.json'), JSON.stringify({ schemaVersion: 1, styleGuide: 'INDEX.md' }, null, 2) + '\n');
    for (const dir of ['project', 'architecture', 'conventions', 'gotchas', 'decisions']) {
      atomicWrite(path.join(this.root, dir, 'INDEX.md'), this.indexSeed(dir));
      this.upsert(dir + '/', { path: dir + '/', summary: `Knowledge about ${dir}.` });
    }
    this.write('_open-questions.md', { title: 'Open questions', summary: 'Unresolved questions for humans and future agents.' }, '# Open questions\n', 'curator');
    this.ensureGitignore();
  }
  ensureGitignore() {
    const file = path.join(this.checkout, '.gitignore');
    const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const relative = path.relative(this.checkout, this.root).split(path.sep).join('/');
    const parents = relative.split('/').slice(0, -1).map((_, i, a) => `!/${a.slice(0, i + 1).join('/')}/\n/${a.slice(0, i + 1).join('/')}/*`);
    const block = `# Agent Office knowledge (committed); journals and telemetry stay local\n${parents.join('\n')}\n!/${relative}/\n!/${relative}/**\n/${relative}/_meta/state/\n/${this.config.handoversDir}/\n`;
    if (!previous.includes(`!/${relative}/**`)) atomicWrite(file, previous.trimEnd() + '\n\n' + block);
  }
  index(relative = '') {
    this.seed();
    const target = relative ? relative.replace(/\/$/, '') + '/INDEX.md' : 'INDEX.md';
    return fs.readFileSync(this.resolve(target), 'utf8');
  }
  read(relative: string, offset = 0, limit?: number) {
    if (!Number.isInteger(offset) || offset < 0 || limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw Error('offset is zero-based; limit must be a positive line count');
    const file = this.resolve(relative); const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    this.stateUpdate('usage.json', data => { data[relative] = Number(data[relative] ?? 0) + 1; });
    return { path: relative, text: offset === 0 && limit === undefined ? text : lines.slice(offset, limit === undefined ? undefined : offset + limit).join('\n'), offset, totalLines: lines.length, nextOffset: limit !== undefined && offset + limit < lines.length ? offset + limit : null };
  }
  tree(): TreeNote[] {
    this.seed(); const result: TreeNote[] = [];
    const walk = (dir: string) => {
      for (const item of fs.readdirSync(path.join(this.root, dir), { withFileTypes: true })) {
        if (item.name === '_meta') continue;
        const relative = [dir, item.name].filter(Boolean).join('/');
        if (item.isSymbolicLink()) { result.push({ path: relative, error: 'Symlink is forbidden' }); continue; }
        if (item.isDirectory()) walk(relative);
        else if (item.name.endsWith('.md') && item.name !== 'INDEX.md') {
          try { result.push({ path: relative, frontmatter: parseKnowledgeNote(fs.readFileSync(this.resolve(relative), 'utf8')).frontmatter }); }
          catch (e) { result.push({ path: relative, error: (e as Error).message }); }
        }
      }
    }; walk(''); return result;
  }
  search(query: string, scope = '') {
    if (!query.trim() || query.length > 2000) throw Error('query must be 1–2000 characters');
    if (scope) this.resolve(scope.endsWith('.md') ? scope : scope.replace(/\/$/, '') + '/INDEX.md');
    const hits: { path: string; title: string; line: number; lines: string[] }[] = []; let omitted = 0;
    for (const note of this.tree()) {
      if (scope && note.path !== scope && !note.path.startsWith(scope.replace(/\/$/, '') + '/')) continue;
      const lines = fs.readFileSync(this.resolve(note.path), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        if (hits.length >= this.config.searchMaxHits) { omitted++; continue; }
        hits.push({ path: note.path, title: note.frontmatter?.title ?? note.path, line: i + 1, lines: lines.slice(Math.max(0, i - 1), i + 2) });
      }
    }
    return { hits, omitted };
  }
  private ensureDirectories(relative: string) {
    const parts = relative.split('/').slice(0, -1); let current = '';
    for (const part of parts) {
      current += part + '/';
      const file = this.resolve(current + 'INDEX.md');
      if (!fs.existsSync(file)) {
        atomicWrite(file, this.indexSeed(part));
        this.upsert(current, { path: part + '/', summary: `Knowledge about ${part}.` });
      }
    }
  }
  private upsert(relative: string, entry?: KnowledgeEntry) {
    const directory = path.posix.dirname(relative.replace(/\/$/, ''));
    const file = this.resolve(directory === '.' ? 'INDEX.md' : directory + '/INDEX.md');
    const index = parseKnowledgeIndex(fs.readFileSync(file, 'utf8'));
    const name = path.posix.basename(relative.replace(/\/$/, '')) + (relative.endsWith('/') ? '/' : '');
    index.entries = index.entries.filter(e => e.path !== name); index.archived = index.archived.filter(e => e.path !== name);
    if (entry) (entry.status === 'archived' ? index.archived : index.entries).push({ ...entry, path: name });
    atomicWrite(file, serializeKnowledgeIndex(index));
  }
  write(relative: string, frontmatter: Partial<KnowledgeFrontmatter>, body: string, author: string) {
    this.seed(); const file = this.resolve(relative, true);
    if (typeof body !== 'string' || !frontmatter || typeof frontmatter !== 'object') throw Error('Send frontmatter and Markdown body');
    const existing = fs.existsSync(file) ? parseKnowledgeNote(fs.readFileSync(file, 'utf8')).frontmatter : {};
    const draft = { ...existing, ...frontmatter, author, updated: new Date().toISOString().slice(0, 10) };
    for (const values of [draft.tags, draft.paths, draft.sources]) if (values?.some(v => /[\r\n]/.test(v))) throw Error('Metadata arrays must contain single-line values');
    if (draft.tags?.some(tag => !/^[a-zA-Z0-9_-]+$/.test(tag))) throw Error('Tags use letters, digits, underscores and hyphens');
    if (draft.summary && /\[(?:tags:|status:|pinned\])/.test(draft.summary)) throw Error('Keep lifecycle markers in frontmatter, not the summary');
    const text = serializeFrontmatter(draft, body); const parsed = parseKnowledgeNote(text);
    rejectCredentials(text);
    if (Buffer.byteLength(text) > this.config.maxNoteBytes) throw Error(`Note exceeds ${this.config.maxNoteBytes} bytes; split it into topics`);
    this.ensureDirectories(relative); atomicWrite(file, text);
    this.upsert(relative, { path: relative, summary: parsed.frontmatter.summary, tags: parsed.frontmatter.tags, status: parsed.frontmatter.status, pinned: parsed.frontmatter.pinned });
    return { path: relative, ...parsed, warning: Buffer.byteLength(text) > 16384 ? 'Consider splitting this note (over 16 KiB).' : undefined };
  }
  move(from: string, to: string) {
    const source = this.resolve(from, true); const dest = this.resolve(to, true);
    if (fs.existsSync(dest)) throw Error('Destination already exists');
    const note = parseKnowledgeNote(fs.readFileSync(source, 'utf8'));
    this.write(to, note.frontmatter, note.body, note.frontmatter.author ?? 'curator');
    fs.unlinkSync(source); this.upsert(from); return { from, to };
  }
  archive(relative: string, reason: string, author: string) {
    if (typeof reason !== 'string' || !reason.trim()) throw Error('Archive needs a reason');
    const note = parseKnowledgeNote(fs.readFileSync(this.resolve(relative, true), 'utf8'));
    return this.write(relative, { ...note.frontmatter, status: 'archived' }, note.body + `\n\nArchived: ${reason}\n`, author);
  }
  stateUpdate(name: string, update: (data: Record<string, unknown>) => void) {
    const file = path.join(this.root, '_meta/state', name); this.validateParents(file);
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> : {};
    update(data); atomicWrite(file, JSON.stringify(data, null, 2) + '\n');
  }
  review(worker: string, revision: number, changed: string[], none_reason?: string) {
    if (!Array.isArray(changed) || changed.some(p => typeof p !== 'string') || !changed.length && !none_reason?.trim()) throw Error('List changed paths or an explicit none_reason');
    for (const p of changed) { this.resolve(p); if (!fs.existsSync(this.resolve(p))) throw Error(`Missing reviewed path: ${p}`); }
    this.stateUpdate('reviews.json', data => { data[`${worker}:${revision}`] = { changed, none_reason, at: new Date().toISOString() }; });
    return { worker, revision, changed, none_reason };
  }
  usage(): Record<string, number> {
    const file = path.join(this.root, '_meta/state/usage.json'); this.validateParents(file);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }
}
