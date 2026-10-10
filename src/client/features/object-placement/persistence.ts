import { validTransform, type Transform } from './model';

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** One key per object avoids overwriting other objects or other floors. */
export class PlacementSave {
  private pending = new Map<string, Transform>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private storage: StorageLike, private failed: () => void) {}
  key(scope: string, id: string) { return `agent-office.placement.v1:${encodeURIComponent(scope)}:${encodeURIComponent(id)}`; }
  load(scope: string, id: string): Transform | null {
    const key = this.key(scope, id);
    if (this.pending.has(key)) return this.pending.get(key)!;
    try { const t: unknown = JSON.parse(this.storage.getItem(key) ?? 'null'); return validTransform(t) ? t : null; }
    catch { return null; }
  }
  queue(scope: string, id: string, t: Transform) {
    this.pending.set(this.key(scope, id), t);
    // Bounded writes during a long gesture, rather than a debounce that can wait forever.
    this.timer ??= setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    for (const [key, t] of this.pending) {
      try { this.storage.setItem(key, JSON.stringify(t)); this.pending.delete(key); }
      catch { this.failed(); }
    }
    return this.pending.size === 0;
  }
}
