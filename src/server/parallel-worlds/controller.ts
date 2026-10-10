import { randomUUID } from 'node:crypto';
import type { ParallelWorld, WorldsExperiment, WorldsRequest } from '../../shared/parallel-worlds.js';
import { worldPrompt } from '../../shared/parallel-worlds.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { WorldsStorage } from './storage.js';

export interface WorldsIO {
  room(): number;
  base(): { commit: string; from: string };
  spawn(request: WorldsRequest, prompt: string, base: { commit: string; from: string }, owner?: string): WorkerInfo | string;
  worker(id: string): WorkerInfo | undefined;
  feedback(id: string, text: string, by: string): string | undefined;
  changed(): void;
}
export class WorldsController {
  constructor(readonly storage: WorldsStorage, private io: WorldsIO) {}
  start(r: WorldsRequest, by: string, owner?: string): WorldsExperiment {
    if (this.storage.state.error) throw Error(this.storage.state.error);
    if (this.storage.state.experiments.some(e => !e.archived)) throw Error('Archive the current experiment before starting another; its workers and branches are kept');
    if (this.storage.state.experiments.length >= 30) throw Error('Experiment history is full (30 experiments)');
    if (this.io.room() < 3) throw Error('Three free desks and capacity for three workers are required');
    const base = this.io.base();
    const e: WorldsExperiment = { id: randomUUID(), task: r.task, agent: r.agent, base: base.commit, from: base.from, createdAt: Date.now(), createdBy: by, owner, worlds: r.approaches.map(a => ({ ...a, id: randomUUID() })) };
    this.storage.state.experiments.push(e);
    // Save the experiment before launching: a partial launch is visible and preserves every branch.
    this.storage.save();
    for (const w of e.worlds) {
      try {
        const worker = this.io.spawn(r, worldPrompt(r.task, w, e.base), base, owner);
        if (typeof worker === 'string') w.error = worker;
        else { w.workerId = worker.id; w.branch = worker.worktree?.branch; }
      } catch (err) { w.error = (err as Error).message; }
      this.storage.save();
    }
    this.io.changed();
    return e;
  }
  experiment(id: string, owner?: string, admin = false): WorldsExperiment {
    const e = this.storage.state.experiments.find(e => e.id === id);
    if (!e) throw Error('No such experiment');
    if (e.owner !== owner && !admin) throw Error('Only the experiment creator or an admin can change it');
    if (this.storage.state.error) throw Error(this.storage.state.error);
    return e;
  }
  world(e: WorldsExperiment, id?: string): ParallelWorld {
    const w = e.worlds.find(w => w.id === id);
    if (!w) throw Error('No such world');
    return w;
  }
  control(e: WorldsExperiment, action: 'select' | 'archive' | 'feedback', id: string | undefined, text: string | undefined, by: string) {
    if (action === 'archive') e.archived = true;
    else {
      if (e.archived) throw Error('This experiment is archived');
      const w = this.world(e, id);
      const worker = w.workerId ? this.io.worker(w.workerId) : undefined;
      if (!worker || worker.lost || !worker.worktree) throw Error('The world worker or its worktree is unavailable');
      if (action === 'select') {
        if (!['done', 'idle'].includes(worker.status)) throw Error('Wait until the world worker finishes before selecting it');
        e.winner = w.id;
      } else {
        if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw Error('Provide feedback (1–12000 characters)');
        const err = this.io.feedback(worker.id, text.trim(), by);
        if (err) throw Error(err);
        // Any revision needs a fresh selection before opening its PR.
        if (e.winner === w.id) e.winner = undefined;
      }
    }
    this.storage.save();
    this.io.changed();
  }
}
