import type { LoreNote } from '../../shared/protocol/lore.js';
import { LoreStore } from '../lore.js';
import { CuratorJournal, fingerprint } from './journal.js';
/** Original notes remain on disk; the curator's overlays and full revisions are recoverable. */
export class CuratorMemory extends LoreStore {
  readonly journal: CuratorJournal;
  changed?: () => void;
  constructor(dataDir: string) { super(dataDir); this.journal = new CuratorJournal(dataDir); this.observe(); }
  raw() { return super.list(); }
  override list() { return this.raw().map(n => this.journal.decorate(n)); }
  override get(id: string) { const note = super.get(id); return note && this.journal.decorate(note); }
  observe() {
    const before = this.journal.data.records;
    this.journal.data.records = structuredClone(before);
    let changed = false;
    for (const n of this.raw()) {
      const fp = fingerprint(n), r = Object.hasOwn(this.journal.data.records, n.id) ? this.journal.data.records[n.id] : undefined;
      if (r?.fingerprint === fp) continue;
      const last = r?.revisions.at(-1);
      if (r && last && last.title.toLowerCase() === n.title.toLowerCase() && last.content === n.content && JSON.stringify(last.tags) === JSON.stringify(n.tags)) {
        r.fingerprint = fp; if (r.processed) r.processed = fp; changed = true; continue;
      }
      Object.defineProperty(this.journal.data.records, n.id, { enumerable: true, configurable: true, writable: true, value: { fingerprint: fp, revisions: [...(r?.revisions ?? []), { ...n }],
        meta: { status: r ? 'needs-verification' : 'active', reason: r ? 'Note changed; awaiting curator verification' : 'Worker-reported knowledge', sources: [n.id], checkedAt: 0 } } });
      changed = true;
    }
    if (changed) { try { this.journal.save(); } catch (e) { this.journal.data.records = before; throw e; } }
  }
  override save(draft: Parameters<LoreStore['save']>[0]): LoreNote {
    const note = super.save(draft); this.observe(); this.changed?.(); return this.journal.decorate(note);
  }
  restore(id: string, revision?: number) {
    const r = this.journal.data.records[id];
    if (!r || !super.get(id)) throw Error('No such knowledge note');
    if (revision !== undefined) {
      if (!Number.isInteger(revision) || revision < 0 || revision >= r.revisions.length) throw Error('Invalid note revision');
      const original = r.revisions[revision]; this.save({ ...original, id });
    }
    const before = this.journal.data.records[id];
    const current = structuredClone(before);
    this.journal.data.records[id] = current;
    delete current.content; delete current.title; delete current.processed;
    current.meta = { status: 'active', reason: 'Restored from curator history; awaiting review', sources: [id], checkedAt: 0 };
    try { this.journal.save(); } catch (e) { this.journal.data.records[id] = before; throw e; }
    this.changed?.();
    return this.get(id)!;
  }
}
