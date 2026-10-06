import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { nextFreeSeat } from '../shared/layout.js';
import { managerHash, managerReport, shouldNudge, type ManagerReport } from '../shared/manager.js';
import { workerRow } from './office-workers.js';
import type { Ctx } from './office/context.js';
import type { Floor } from './floor.js';

/** One thing the Manager agent posted about the floor: its standup, or a question for everyone. */
export interface ManagerNote {
  at: number;
  /** Who posted it. */
  worker: string;
  kind: 'standup' | 'question';
  text: string;
}

/**
 * Keeps what the Manager agent posts (POST /office/workers/report) in the floor's
 * `.agent-office/manager.jsonl`, one JSON line each, readable only by whoever owns the floor (0600),
 * beside the queue's own `queue.json`. Disk issues don't take the office down: the note still goes out
 * to the floor, and the answer says where it should have been kept.
 */
export function writeManagerNote(projectDir: string, note: ManagerNote): string {
  const file = path.join(projectDir, '.agent-office', 'manager.jsonl');
  try {
    appendFileSync(file, `${JSON.stringify(note)}\n`, { mode: 0o600 });
  } catch {
    // disk issues shouldn't take the office down
  }
  return file;
}

/** One report builder for the authenticated command and manager nudges. */
export function floorReport(ctx: Ctx, floor: Floor): ManagerReport {
  const tasks = floor.queue.state().tasks, pulls = floor.forge.pulls.items, crew = floor.workers.list();
  return managerReport({
    workers: crew, rows: crew.map(w => workerRow(w, { pulls, tasks, pullsOf: id => ctx.anyFloor(id)?.forge.pulls.items })), tasks, pulls,
    floor: { id: floor.id, name: floor.def.name, ...(floor.def.repo ? { repo: floor.def.repo } : {}), branch: floor.project.branch ?? '' },
    maxWorkers: floor.queue.limit, freeDesk: nextFreeSeat(id => floor.workers.deskOccupied(id), floor.plan.wing)?.id ?? null,
    ...(ctx.ledger.hiringPaused ? { hiringPaused: ctx.ledger.hiringPaused } : {}), now: Date.now(),
  });
}

/** Nudge an existing manager once per changed report; never hire one automatically. */
export function startManagerClock(ctx: Ctx): () => void {
  const nudged = new Map<string, string>();
  const timer = setInterval(() => {
    for (const floor of ctx.floors.values()) {
      let hash: string;
      try { hash = managerHash(floorReport(ctx, floor)); } catch { continue; }
      if (!shouldNudge(nudged.get(floor.id), hash, floor.workers.list().some(w => w.deskId === 'station-manager'))) continue;
      nudged.set(floor.id, hash);
      void floor.workers.station('station-manager', 'The office', "The floor has changed. Read office-workers status, then report what's completed, ongoing and needs a decision with office-workers report --kind standup.");
    }
  }, 60_000);
  return () => clearInterval(timer);
}
