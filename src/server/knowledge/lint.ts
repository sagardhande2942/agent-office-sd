import fs from 'node:fs';
import path from 'node:path';
import { KnowledgeStore, atomicWrite, rejectCredentials } from './store.js';
import { parseFrontmatter, parseKnowledgeIndex, serializeKnowledgeIndex, type KnowledgeEntry } from '../../shared/knowledge-index.js';
export interface KnowledgeLint { errors: string[]; warnings: string[]; fixed: string[] }
/** Corrupt notes are reported, never repaired or rewritten. Only index blocks are regenerated. */
export function lintKnowledge(store: KnowledgeStore, fix = false): KnowledgeLint {
  const result: KnowledgeLint = { errors: [], warnings: [], fixed: [] };
  const rootIndex = store.resolve('INDEX.md');
  if (!fs.existsSync(rootIndex) && fs.existsSync(store.root) && fs.readdirSync(store.root).length) {
    if (!fix) { result.errors.push('INDEX.md: missing root index; run lint --fix'); return result; }
    atomicWrite(rootIndex, '---\nkind: index\nsummary: Project knowledge and navigation.\n---\n# Knowledge\n\nWrite for a stranger. Include commands verbatim. One topic per file; split beyond about 200 lines and split directories beyond about 40 entries. Never paste secrets.\n\n## Entries\n');
    result.fixed.push('INDEX.md');
  }
  store.seed();
  const notes = new Map(store.tree().map(n => [n.path, n]));
  const walk = (relative: string) => {
    const dir = path.join(store.root, relative); const children: KnowledgeEntry[] = [];
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (child.name === '_meta') {
        try {
          const meta = new KnowledgeStore(store.checkout, { dir: path.relative(store.checkout, path.join(dir, child.name)) });
          const config = path.join(meta.root, 'config.json');
          if (fs.lstatSync(config).isSymbolicLink()) throw Error('Metadata config symlink forbidden');
          const text = fs.readFileSync(config, 'utf8'); rejectCredentials(text);
          const fields = JSON.parse(text); if (fields.schemaVersion !== 1 || fields.styleGuide !== 'INDEX.md') throw Error('Invalid knowledge schema/style guide configuration');
        } catch (e) { result.errors.push(`_meta: ${(e as Error).message}`); }
        continue;
      }
      const p = [relative, child.name].filter(Boolean).join('/');
      if (child.isSymbolicLink()) { result.errors.push(`${p}: symlinks forbidden`); continue; }
      if (child.isDirectory()) {
        walk(p);
        try { const text = store.index(p); children.push({ path: child.name + '/', summary: String(parseFrontmatter(text).fields.summary) }); }
        catch (e) { result.errors.push(`${p}: ${(e as Error).message}`); }
      } else if (child.name.endsWith('.md') && child.name !== 'INDEX.md') {
        const note = notes.get(p)!; const text = fs.readFileSync(store.resolve(p), 'utf8');
        try { rejectCredentials(text); } catch (e) { result.errors.push(`${p}: ${(e as Error).message}`); }
        if (Buffer.byteLength(text) > store.config.maxNoteBytes) result.errors.push(`${p}: exceeds safety cap`);
        else if (Buffer.byteLength(text) > 16384) result.warnings.push(`${p}: over 16 KiB; consider splitting`);
        if (!note.frontmatter) { result.errors.push(`${p}: ${note.error}`); continue; }
        const f = note.frontmatter; children.push({ path: child.name, summary: f.summary, tags: f.tags, status: f.status, pinned: f.pinned });
      } else if (child.name !== 'INDEX.md') result.errors.push(`${p}: unexpected non-Markdown file`);
    }
    const p = [relative, 'INDEX.md'].filter(Boolean).join('/'); const file = store.resolve(p);
    if (children.length > 40) result.warnings.push(`${p}: more than 40 entries; split this directory`);
    try {
      let text: string;
      if (!fs.existsSync(file)) {
        if (!fix) { result.errors.push(`${p}: missing index`); return; }
        text = `---\nkind: index\nsummary: Knowledge about ${relative || 'this project'}.\n---\n# ${relative || 'Knowledge'}\n\n## Entries\n`;
      } else text = fs.readFileSync(file, 'utf8');
      rejectCredentials(text);
      const index = parseKnowledgeIndex(text);
      const expected = serializeKnowledgeIndex({ prose: index.prose, entries: children.filter(e => e.status !== 'archived'), archived: children.filter(e => e.status === 'archived') });
      // A malformed child cannot safely be used to regenerate entries: retain its existing link.
      if ([...notes.values()].some(n => n.error && path.posix.dirname(n.path) === (relative || '.'))) {
        result.errors.push(`${p}: cannot regenerate until invalid children are corrected`); return;
      }
      if (text.replace(/\r\n/g, '\n') !== expected) {
        if (fix) { atomicWrite(file, expected); if (!result.fixed.includes(p)) result.fixed.push(p); }
        else result.errors.push(`${p}: stale, missing, duplicate or unsorted entries; use lint --fix`);
      }
    } catch (e) { result.errors.push(`${p}: ${(e as Error).message}`); }
  }; walk(''); return result;
}
