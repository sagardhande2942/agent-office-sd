import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validPlacement, type ObjectTransform, type PlacementState } from '../../shared/object-placement.js';

/** Office-owned scene state, including hosted floors; atomic writes never depend on a remote checkout. */
export class Placements {
  private items: PlacementState = {};
  private dirty = false;
  constructor(private file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      if (raw?.version === 1 && raw.items && typeof raw.items === 'object') {
        for (const [id, t] of Object.entries(raw.items)) if (validPlacement(id, t)) this.items[id] = t;
      }
    } catch { /* New or corrupt layouts start safely at defaults. */ }
  }
  state(): PlacementState { return structuredClone(this.items); }
  get(id: string): ObjectTransform | undefined { const t = this.items[id]; return t && structuredClone(t); }
  get unsaved() { return this.dirty; }
  set(id: string, t: unknown, onlyIfMissing = false) {
    if (!validPlacement(id, t)) throw Error('That object or transform is not editable');
    if (onlyIfMissing && Object.hasOwn(this.items, id)) return false;
    const transform = { position: [...t.position], rotation: [...t.rotation], scale: [...t.scale] };
    if (JSON.stringify(this.items[id]) === JSON.stringify(transform)) return false;
    this.items[id] = transform; this.dirty = true; return true;
  }
  flush(): boolean {
    if (!this.dirty) return false;
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify({ version: 1, items: this.items }), { mode: 0o600 });
    renameSync(temporary, this.file); this.dirty = false; return true;
  }
}
