import { sameRepo } from '../../shared/floors.js';
import { validJoinProject } from '../../shared/floor-join.js';
import type { FloorDef } from '../building.js';
import type { Host } from '../hosts.js';
import type { Ctx } from '../office/context.js';

/** Register only on the authenticated machine, never open its path on the office. */
export function registerJoinProject(ctx: Pick<Ctx, 'building'>, host: Host, value: unknown): FloorDef | string {
  if (!validJoinProject(value)) return 'Invalid project: provide an absolute checkout path and repository as OWNER/REPO';
  const existing = ctx.building.list().find(d => sameRepo(d.repo, value.repo));
  if (existing) {
    if (existing.host !== host.id || existing.dir !== value.dir) return `${value.repo} already has a floor with a different machine or checkout. For a lost connection, ask the office admin to use Reconnect this machine on the original offline machine in Connect your floor, and use its original checkout path.`;
    return existing;
  }
  return ctx.building.addHosted({ ...value, host: host.id }, host.name);
}

export function installFloorJoin(ctx: Ctx, openFloor: (def: FloorDef) => unknown) {
  ctx.registry.onAuthenticated = (host, hello) => {
    if (hello.project === undefined) return;
    const result = registerJoinProject(ctx, host, hello.project);
    if (typeof result === 'string') return result;
    if (!ctx.remoteFloors.has(result.id)) openFloor(result);
    ctx.floorsChanged();
  };
}
