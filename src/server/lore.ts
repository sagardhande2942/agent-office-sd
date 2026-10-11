import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LoreNote } from '../shared/protocol/lore.js';
import { cleanLoreContent, cleanLoreTitle, parseLoreTags } from '../shared/lore.js';

function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/**
 * A floor's repository lore & shift handover notes, kept in `.agent-office/lore/<id>.json`.
 */
export class LoreStore {
  private readonly dir: string;
  private readonly notes = new Map<string, LoreNote>();

  constructor(floorDataDir: string) {
    this.dir = path.resolve(floorDataDir, 'lore');
    this.load();
  }

  private fileFor(id: string): string {
    if (!validId(id)) throw new Error('Invalid lore note ID');
    const file = path.resolve(this.dir, `${id}.json`);
    if (path.dirname(file) !== this.dir) throw new Error('Invalid lore note path');
    return file;
  }

  private load() {
    this.notes.clear();
    if (!existsSync(this.dir)) return;
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(path.join(this.dir, file), 'utf8')) as Partial<LoreNote>;
          if (validId(raw?.id) && file === `${raw.id}.json` && typeof raw?.title === 'string' && typeof raw?.content === 'string') {
            const note: LoreNote = {
              id: raw.id,
              title: cleanLoreTitle(raw.title),
              content: cleanLoreContent(raw.content),
              author: String(raw.author || 'Anonymous').trim(),
              ...(raw.workerId ? { workerId: String(raw.workerId) } : {}),
              ...(raw.desk ? { desk: String(raw.desk) } : {}),
              ...(raw.pr && typeof raw.pr.number === 'number' ? { pr: { number: raw.pr.number, ...(raw.pr.url ? { url: String(raw.pr.url) } : {}) } } : {}),
              tags: parseLoreTags(raw.tags),
              createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
              updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
            };
            this.notes.set(note.id, note);
          }
        } catch {
          // ignore corrupted single note file
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  list(): LoreNote[] {
    return [...this.notes.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): LoreNote | undefined {
    return this.notes.get(id);
  }

  save(draft: {
    id?: string;
    title: string;
    content: string;
    author: string;
    workerId?: string;
    desk?: string;
    pr?: { number: number; url?: string };
    tags?: string[];
  }): LoreNote {
    const now = Date.now();
    const id = draft.id === undefined ? `lore-${now}-${Math.random().toString(36).slice(2, 7)}` : draft.id;
    const file = this.fileFor(id);
    const existing = this.notes.get(id);
    const note: LoreNote = {
      id,
      title: cleanLoreTitle(draft.title),
      content: cleanLoreContent(draft.content),
      author: draft.author?.trim() || existing?.author || 'Anonymous',
      ...(draft.workerId || existing?.workerId ? { workerId: draft.workerId || existing?.workerId } : {}),
      ...(draft.desk || existing?.desk ? { desk: draft.desk || existing?.desk } : {}),
      ...(draft.pr || existing?.pr ? { pr: draft.pr || existing?.pr } : {}),
      tags: parseLoreTags(draft.tags ?? existing?.tags),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }

    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    writeFileSync(tmp, JSON.stringify(note, null, 2), { mode: 0o600 });
    renameSync(tmp, file);

    this.notes.set(id, note);
    return note;
  }

  delete(id: string): boolean {
    if (!validId(id)) return false;
    const existing = this.notes.get(id);
    if (!existing) return false;
    try {
      unlinkSync(this.fileFor(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    }
    this.notes.delete(id);
    return true;
  }
}
