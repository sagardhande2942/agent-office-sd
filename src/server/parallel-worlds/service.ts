import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { DESKS, WING_DESKS, deskBuilt, nextFreeSeat } from '../../shared/layout.js';
import type { WorldsResponse } from '../../shared/parallel-worlds.js';
import { WorldsController } from './controller.js';
import { WorldsStorage } from './storage.js';

const controllers = new WeakMap<Floor, WorldsController>();
const git = (dir: string, args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export function worlds(ctx: Ctx, floor: Floor): WorldsController {
  let controller = controllers.get(floor);
  if (controller) return controller;
  controller = new WorldsController(new WorldsStorage(path.join(floor.dir, '.agent-office', 'parallel-worlds.json')), {
    room: () => Math.min(ctx.machine.room(), [...DESKS, ...WING_DESKS].filter(d => deskBuilt(d, floor.plan.wing) && !floor.workers.deskOccupied(d.id)).length),
    base: () => {
      const from = git(floor.dir, ['branch', '--show-current']);
      if (!from) throw Error('Parallel worlds requires a named Git branch');
      const head = git(floor.dir, ['rev-parse', 'HEAD']);
      let commit = head;
      try {
        const remote = git(floor.dir, ['rev-parse', '--verify', `refs/remotes/origin/${from}^{commit}`]);
        try { git(floor.dir, ['merge-base', '--is-ancestor', remote, head]); }
        catch { commit = remote; }
      } catch { /* Local-only repositories use HEAD, like ordinary worker worktrees. */ }
      return { commit, from };
    },
    spawn: (r, prompt, base, owner) => {
      const desk = nextFreeSeat(id => floor.workers.deskOccupied(id), floor.plan.wing);
      if (!desk) return 'No free desks';
      return floor.workers.spawn(desk.id, 'Parallel worlds', prompt, true, 'agent', r.agent.provider, r.agent.model, r.agent.effort, undefined, owner, [], undefined, undefined, undefined, base);
    },
    worker: id => floor.workers.get(id),
    feedback: (id, text, by) => {
      const worker = floor.workers.get(id);
      if (worker && ['offline', 'exited'].includes(worker.status)) return floor.workers.resume(id, text);
      return floor.workers.prompt(id, text, by);
    },
    changed: () => ctx.toFloor(floor, { t: 'worlds.changed', floor: floor.id }),
  });
  controllers.set(floor, controller);
  return controller;
}
export function worldsView(ctx: Ctx, floor: Floor): WorldsResponse {
  const state = worlds(ctx, floor).storage.state;
  return { error: state.error, experiments: state.experiments.map(e => {
    const { owner: _owner, ...view } = e;
    return { ...view, worlds: e.worlds.map(w => {
      const worker = w.workerId ? floor.workers.get(w.workerId) : undefined;
      return { ...w, worker: worker && { name: worker.name, status: worker.status, activity: worker.activity, worktree: worker.worktree, lost: worker.lost, pr: worker.pr, usage: worker.usage, completion: worker.completion } };
    }) };
  }) };
}
