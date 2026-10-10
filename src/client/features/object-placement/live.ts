import type { PlacementClientMsg, PlacementServerMsg } from '../../../shared/protocol/object-placement';
import type { ObjectTransform } from '../../../shared/object-placement';

/** Optimistic transforms with bounded previews and an unthrottled, acknowledged final update. */
export class LivePlacements {
  private pending = new Map<string, PlacementClientMsg>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request = 0;
  private ready = false;
  constructor(private send: (msg: PlacementClientMsg) => void, private connected: () => boolean) {}
  key(floor: string, map: string, id: string) { return JSON.stringify([floor, map, id]); }
  queue(floor: string, map: string, id: string, transform: ObjectTransform, onlyIfMissing = false) {
    this.pending.set(this.key(floor, map, id), { t: 'placement.set', floor, map, id, transform, request: ++this.request, final: false, onlyIfMissing });
    this.timer ??= setTimeout(() => { this.timer = undefined; this.publish(false, floor, map); }, 40);
  }
  load(floor: string, map: string, id: string) { return this.pending.get(this.key(floor, map, id))?.transform; }
  welcome(floor: string | null, map: string) { this.ready = true; if (floor) this.publish(true, floor, map); }
  disconnected() { this.ready = false; clearTimeout(this.timer); this.timer = undefined; }
  flush(floor: string | null, map: string) {
    clearTimeout(this.timer); this.timer = undefined;
    if (floor) this.publish(true, floor, map);
  }
  private publish(final: boolean, floor: string, map: string) {
    if (!this.ready || !this.connected()) return;
    for (const msg of this.pending.values()) if (msg.floor === floor && msg.map === map) this.send({ ...msg, final: final || msg.onlyIfMissing === true });
  }
  /** Ignore delayed echoes of our older optimistic edits, but accept other editors' updates. */
  receive(msg: PlacementServerMsg, you: string): boolean {
    const key = this.key(msg.floor, msg.map, msg.id), pending = this.pending.get(key);
    if (msg.t === 'placement.changed' && msg.by === you && pending) {
      if (msg.request !== pending.request) return false;
      if (!msg.saved) return false;
    } else if (msg.t === 'placement.rejected' && pending && msg.request !== pending.request) return false;
    this.pending.delete(key); return true;
  }
}
