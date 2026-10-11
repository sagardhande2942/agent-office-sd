import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LoreNote } from '../../shared/protocol/lore.js';
import type { CuratorSettings, CuratorRun, CurationMeta } from '../../shared/lore-curator.js';
import { DEFAULT_CURATOR_SETTINGS, validateCuratorSettings } from '../../shared/lore-curator.js';
export const fingerprint = (note: LoreNote) => createHash('sha256').update(JSON.stringify([note.title, note.content, note.tags, note.updatedAt])).digest('hex');
export interface NoteRecord { fingerprint: string; processed?: string; reviewedAt?: number; meta: CurationMeta; revisions: LoreNote[]; content?: string; title?: string }
export interface JournalData { settings: CuratorSettings; nextRunAt?: number; retryAt?: number; eventAt?: number; failures: number; runs: CuratorRun[]; records: Record<string, NoteRecord> }
export class CuratorJournal {
  private file: string;
  data: JournalData = { settings: { ...DEFAULT_CURATOR_SETTINGS }, failures: 0, runs: [], records: {} };
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'lore-curator.json');
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as JournalData;
      this.data = { ...saved, settings: validateCuratorSettings(saved.settings) };
      if (!saved.records || !Array.isArray(saved.runs)) throw Error('Invalid curator journal; preserve the file and repair it before restarting');
      for (const run of this.data.runs) if (run.status === 'running') { run.status = 'failed'; run.summary = 'Office restarted before this run completed; pending notes will retry'; run.finishedAt = Date.now(); this.data.retryAt = Date.now(); this.data.failures++; }
    }
  }
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + `.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  decorate(note: LoreNote): LoreNote {
    const r = this.data.records[note.id];
    if (r && r.fingerprint !== fingerprint(note)) return { ...note, curation: { status: 'needs-verification', reason: 'Note changed since curator snapshot', sources: [note.id], checkedAt: 0 } };
    return r ? { ...note, ...(r.title ? { title: r.title } : {}), ...(r.content ? { content: r.content } : {}), curation: r.meta } : note;
  }
}
