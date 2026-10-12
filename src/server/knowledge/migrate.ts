import { fingerprint } from '../lore-curator/journal.js';
import type { NoteRecord } from '../lore-curator/journal.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { KnowledgeStore, atomicWrite } from './store.js';
import { lintKnowledge } from './lint.js';
export function migrateKnowledge(store: KnowledgeStore) {
  store.seed(); const dir = path.join(store.checkout, '.agent-office/lore'); const imported: string[] = []; const errors: string[] = [];
  new KnowledgeStore(store.checkout, { dir: '.agent-office/lore' });
  if (!fs.existsSync(dir)) return { imported, errors, lint: lintKnowledge(store, true) };
  const journalFile = path.join(store.checkout, '.agent-office/lore-curator.json');
  let records: Record<string, NoteRecord> = {};
  if (fs.existsSync(journalFile)) {
    if (fs.lstatSync(journalFile).isSymbolicLink()) throw Error('Legacy journal symlink forbidden');
    records = JSON.parse(fs.readFileSync(journalFile, 'utf8')).records ?? {};
  }
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      if (fs.lstatSync(path.join(dir, file)).isSymbolicLink()) throw Error('Legacy symlink forbidden');
      const note = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (typeof note.title !== 'string' || typeof note.content !== 'string') throw Error('Legacy note needs title/content');
      const id = createHash('sha256').update(file).digest('hex').slice(0, 12);
      const slug = (note.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) || 'note') + '-' + id;
      if (note.tags?.includes('handover') || String(note.id ?? '').startsWith('handover-')) {
        const journal = path.resolve(store.checkout, store.config.handoversDir);
        new KnowledgeStore(store.checkout, { dir: store.config.handoversDir });
        const target = path.join(journal, `${slug}.md`);
        if (!fs.existsSync(target)) { atomicWrite(target, note.content); imported.push(path.relative(store.checkout, target)); }
        continue;
      }
      const overlay = records[note.id];
      const unchanged = overlay && overlay.fingerprint === fingerprint(note);
      if (unchanged) { note.title = overlay.title ?? note.title; note.content = overlay.content ?? note.content; }
      const status = note.status ?? note.curation?.status ?? (overlay ? unchanged ? overlay.meta.status : 'needs-verification' : 'active'); const archived = ['archived', 'superseded'].includes(status);
      const p = `_imported/${archived ? '_archive/' : ''}${slug}.md`;
      if (fs.existsSync(store.resolve(p))) continue;
      store.write(p, { title: note.title, summary: note.summary ?? note.title, tags: note.tags ?? [], status: archived ? 'archived' : status === 'needs-verification' ? status : 'active', sources: note.sources ?? note.curation?.sources ?? (unchanged ? overlay.meta.sources : [String(note.id ?? file)]), author: note.author ?? 'curator' }, note.content, note.author ?? 'curator');
      // Preserve the historical updated date rather than stamping a fresh verification claim.
      const target = store.resolve(p); const date = new Date(note.updatedAt ?? note.createdAt ?? Date.now()).toISOString().slice(0, 10);
      atomicWrite(target, fs.readFileSync(target, 'utf8').replace(/^updated: .*$/m, `updated: "${date}"`)); imported.push(p);
    } catch (e) { errors.push(`${file}: ${(e as Error).message}`); }
  }
  return { imported, errors, lint: lintKnowledge(store, true) };
}
