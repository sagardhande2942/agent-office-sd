import fs from 'node:fs';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { ServerMsg, KnowledgeTreeView } from '../../shared/protocol.js';
import { KnowledgeStore } from './store.js';
import { loadKnowledgeConfig } from './settings.js';
import { deliveries, syncKnowledge, type DeliveryOptions } from './delivery.js';
import { LocalKnowledge } from './surface.js';

/** The checkout owner polls reviews even when no client has the shelf open. */
export class KnowledgeAutoSync {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closed = false;
  private lastError?: string;
  constructor(private checkout: string, private publish: (msg: ServerMsg) => void, private options: { timer?: boolean; intervalMs?: number; delivery?: DeliveryOptions } = {}) {
    if (options.timer !== false) {
      this.timer = setInterval(() => { void this.tick(); }, options.intervalMs ?? 60_000);
      this.timer.unref();
      queueMicrotask(() => { void this.tick(); });
    }
  }
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.check().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async check() {
    try {
      const store = new KnowledgeStore(this.checkout, loadKnowledgeConfig(this.checkout));
      // Legacy floors may not have a Knowledge tree yet. Reading state must not create a partial tree.
      if (!fs.existsSync(path.join(store.root, 'INDEX.md'))) return;
      const reviews = deliveries(store);
      if (!reviews.some(r => r.state === 'published')) { this.lastError = undefined; return; }
      const before = JSON.stringify(reviews);
      const result = await syncKnowledge(store, this.options.delivery);
      this.lastError = undefined;
      if (this.closed || before === JSON.stringify(deliveries(store))) return;
      const tree = new LocalKnowledge(this.checkout).execute({ t: 'knowledge.tree' }, 'Automatic sync') as KnowledgeTreeView;
      this.publish({ t: 'knowledge/tree', tree });
      this.publish({ t: 'knowledge/status', message: result.message });
    } catch (error) {
      const message = `Automatic knowledge sync failed; will retry: ${error instanceof Error ? error.message : String(error)}`;
      if (!this.closed && message !== this.lastError) this.publish({ t: 'knowledge/status', message });
      this.lastError = message;
    }
  }
  close() { this.closed = true; if (this.timer) clearInterval(this.timer); }
}

const services = new WeakMap<Floor, KnowledgeAutoSync>();
export function installKnowledgeAutoSync(floor: Floor, publish: (msg: ServerMsg) => void) {
  if (!services.has(floor)) services.set(floor, new KnowledgeAutoSync(floor.def.dir, publish));
}
export function closeKnowledgeAutoSync(floor: Floor) { services.get(floor)?.close(); services.delete(floor); }
