import { syncHelperReports, reconcileHelperReports } from './helper-reports.js';
import path from 'node:path';
import { Communications } from '../communications.js';
import type { Ctx } from './context.js';
import type { FloorActions } from '../floor-actions.js';

const stores = new WeakMap<Ctx, Map<string, Communications>>();

export function communications(ctx: Ctx, floor: FloorActions): Communications {
  let ledgers = stores.get(ctx);
  if (!ledgers) stores.set(ctx, ledgers = new Map());
  let ledger = ledgers.get(floor.id);
  if (!ledger) {
    ledger = new Communications(path.join(ctx.cfg.dataDir, 'communications', Buffer.from(floor.id).toString('hex')), state => {
      syncHelperReports(floor, state);
      for (const c of ctx.clients.values()) if (c.peer.floor === floor.id) ctx.sendTo(c, { t: 'communications', state });
    });
    ledgers.set(floor.id, ledger);
    syncHelperReports(floor, ledger.state());
  }
  reconcileHelperReports(floor, ledger);
  return ledger;
}

export function startCommunicationClock(ctx: Ctx): () => void {
  const clock = setInterval(() => {
    for (const [id, ledger] of stores.get(ctx) ?? []) {
      const state = ledger.state();
      for (const c of ctx.clients.values()) if (c.peer.floor === id) ctx.sendTo(c, { t: 'communications', state });
    }
  }, 30_000);
  clock.unref();
  return () => clearInterval(clock);
}
