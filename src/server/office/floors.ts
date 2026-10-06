import type { FloorActions } from '../floor-actions.js';
import { RemoteFloor } from '../remote-floor.js';
import { existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { FloorDef } from '../building.js';
import { Floor, type FloorContext } from '../floor.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorInfo, ServerMsg } from '../../shared/protocol.js';
import type { Ctx, FloorHelpers, FloorsOpen } from './context.js';
import { SLOW_CLIENT_BYTES, type Client } from './client.js';

/** Finding floors, the elevator's list of them, and taking one off the building. */
export function floorHelpers(ctx: Ctx): FloorHelpers {
  const anyFloor = (id: string | null | undefined): FloorActions | undefined => id ? ctx.floors.get(id) ?? ctx.remoteFloors.get(id) : undefined;
  const anyFloors = (): FloorActions[] => [...ctx.floors.values(), ...ctx.remoteFloors.values()];
  const floorCount = () => anyFloors().length;
  const asLocal = (floor: FloorActions | undefined) => floor ? ctx.floors.get(floor.id) : undefined;
  const actionWorkerFloor = (id: string) => anyFloors().find(f => f.workers.get(id));
  const withLocalFloor = (c: Client, floor: FloorActions, feature: 'the dog' | 'the docs' | 'the whiteboard', go: (floor: Floor) => void) => {
    const local = asLocal(floor);
    if (local) go(local); else ctx.warn(c, floor.refuses(feature));
  };
  const floorOf = (c: Client) => anyFloor(c.peer.floor);
  /** The floor a worker sits on. Worker ids are unique across the building. */
  const workerFloor = (workerId: string): Floor | undefined => {
    for (const f of ctx.floors.values()) if (f.workers.get(workerId)) return f;
    return undefined;
  };
  const floorInfos = (): FloorInfo[] => [
    ...[...ctx.floors.values()].map((f) => ({ ...f.info(), ...(ctx.building.isLocal(f.id) ? { local: true } : {}) })),
    ...[...ctx.remoteFloors.values()].map(f => f.info()),
    ...ctx.building.pending().map((d) => ({ id: d.id, name: d.name, repo: d.repo, dir: d.dir, palette: d.palette, addedBy: d.addedBy, addedAt: d.addedAt, cloning: true, clone: ctx.building.cloneProgress(d.id), workers: 0, busy: 0, waiting: 0, people: 0, wing: 0 })),
  ];
  // The elevator's counts change with every worker update; tell everyone at most a few times a second.
  let floorsSent = '';
  let floorsTimer: NodeJS.Timeout | undefined;
  const floorsChanged = () => {
    floorsTimer ??= setTimeout(() => {
      floorsTimer = undefined;
      const list = floorInfos();
      const json = JSON.stringify(list);
      if (json === floorsSent) return;
      floorsSent = json;
      ctx.broadcast({ t: 'floors', floors: list });
    }, 250);
  };
  /** Where someone arriving goes: the floor they asked for, else the first one there is. */
  const arrivalFloor = (wanted: string | null) => (wanted && anyFloor(wanted)) || anyFloors()[0];

  /**
   * Takes `floor` off the building (already out of floors.json): everyone on it rides the elevator to
   * the next floor, or out to the lobby if it was the last (the roof goes with it), and its workers stop.
   */
  const closeFloor = (floor: FloorActions, who: string) => {
    const name = floor.def.name;
    const next = anyFloors().find((f) => f !== floor);
    // The list without it first, so nobody arrives somewhere (the lobby's panel) that still shows it.
    const list = floorInfos().filter((f) => f.id !== floor.id);
    floorsSent = JSON.stringify(list);
    ctx.broadcast({ t: 'floors', floors: list });
    for (const c of ctx.clients.values()) {
      if (c.peer.floor === floor.id || (!next && c.peer.floor === ROOF)) {
        if (next) ctx.goToFloor(c, next);
        else ctx.toLobby(c);
        ctx.sendTo(c, { t: 'toast', text: next ? `🛗 ${who} took ${name} off the building, so you rode the elevator to ${next.def.name}` : `🛗 ${who} took ${name}, the last floor, off the building`, level: 'warn' });
      } else ctx.sendTo(c, { t: 'toast', text: `🛗 ${who} took ${name} off the building`, level: 'info' });
    }
    const local = asLocal(floor);
    local?.shutdown();
    ctx.floors.delete(floor.id);
    const remote = ctx.remoteFloors.get(floor.id);
    if (remote) { remote.onGone(floor.id); ctx.remoteFloors.delete(floor.id); }
    else ctx.floors.get(floor.id)?.shutdown();
    floorsChanged();
    // Its workers made room under the worker limit.
    ctx.pumpQueues();
  };

  return { anyFloor, anyFloors, floorCount, asLocal, withLocalFloor, actionWorkerFloor, floorOf, workerFloor, floorInfos, floorsChanged, cancelFloorsChanged: () => clearTimeout(floorsTimer), arrivalFloor, closeFloor };
}

/**
 * Opens every floor of the building, with what they need of the office (see FloorContext), and waits
 * until the workers still running from the last office are back at their desks.
 */
export async function openFloors(ctx: Ctx, hookPort: number): Promise<FloorsOpen> {
  const { cfg, floors, clients } = ctx;
  const floorContext: FloorContext = {
    agentCmd: cfg.agentCmd,
    agentArgs: cfg.agentArgs,
    dshProfile: cfg.dshProfile,
    hook: { url: `http://127.0.0.1:${hookPort}`, token: '' },
    ledger: ctx.ledger,
    capacity: ctx.machine,
    prompts: ctx.prompts,
    emit: ctx.toFloor,
    toast: ctx.toastFloor,
    termData: (workerId, data, viewers) => {
      const json = JSON.stringify({ t: 'term.data', workerId, data } satisfies ServerMsg);
      for (const id of viewers) {
        const c = clients.get(id);
        if (!c || c.ws.readyState !== WebSocket.OPEN) continue;
        // A viewer on a slow link skips output and gets a fresh snapshot once it catches up,
        // instead of queueing unbounded data in server memory.
        if (c.stale.has(workerId) || c.ws.bufferedAmount > SLOW_CLIENT_BYTES) c.stale.add(workerId);
        else c.ws.send(json);
      }
    },
    changes: (state, ids) => {
      for (const id of ids) {
        const c = clients.get(id);
        if (c) ctx.sendTo(c, { t: 'changes', state });
      }
    },
    workerChanged: (floor, w) => {
      if (typeof w === 'string') {
        ctx.webhook.onWorkerGone(w);
        ctx.pumpQueues(floor);
      } else ctx.webhook.onWorker(w);
      ctx.machine.workersChanged();
      ctx.floorsChanged();
    },
    people: (floor) => {
      let n = 0;
      for (const c of clients.values()) if (c.peer.floor === floor.id) n++;
      return n;
    },
    peers: (floor) => [...clients.values()].filter((c) => c.peer.floor === floor.id).map((c) => c.peer),
    leaveOnMerge: () => ctx.leaveOnMerge.on,
    floor: (id) => floors.get(id),
    pullsChanged: (floor) => {
      for (const f of floors.values()) if (f !== floor && worksIn(f, floor)) f.sendLandedHome();
    },
    lent: (floor) => [...ctx.floors.values()].some((f) => f !== floor && worksIn(f, floor)),
    locksUp: () => !!ctx.maps.plan().sendHome?.keeps,
    runAs: ctx.signins,
    forgeAs: (owner, kind) => (owner ? ctx.signins.forgeAs(owner, kind) : undefined),
  };
  /** Whether a worker on `from` works in `on`'s project too (see WorkerInfo.repos). */
  const worksIn = (from: Floor, on: Floor) => from.workers.list().some((w) => w.repos?.some((r) => r.floor === on.id));
  const openFloor = (def: FloorDef): Floor | undefined => {
    // A hosted floor's `dir` is a path on the ctx.machine that runs it, so it is not ours to check: asking
    // existsSync here would ask the wrong ctx.machine and keep the floor closed forever. Instead it is
    // registered as a proxy, and it opens when its ctx.machine connects and says `ready` (finding 9).
    if (def.host) {
      const machine = ctx.hosts.get(def.host);
      ctx.remoteFloors.set(
        def.id,
        new RemoteFloor(
          def.id,
          machine?.name ?? 'a machine',
          def.host,
          ctx.registry,
          { id: def.id, name: def.name, dir: def.dir, repo: def.repo, palette: def.palette, addedBy: def.addedBy, addedAt: def.addedAt },
        ),
      );
      return undefined;
    }
    if (!existsSync(def.dir)) {
      console.error(`agent-office: the ${def.name} floor's checkout is gone (${def.dir}) — it stays closed until it's back`);
      return undefined;
    }
    try {
      const floor = new Floor(def, floorContext);
      floors.set(def.id, floor);
      return floor;
    } catch (err) {
      console.error(`agent-office: couldn't open the ${def.name} floor: ${(err as Error).message}`);
      return undefined;
    }
  };
  // Started in a project: it's a floor too (the one it has always been).
  if (cfg.project) ctx.building.ensureLocal(cfg.project, 'the office');
  for (const def of ctx.building.list()) openFloor(def);
  // Clones keep the elevator's progress up to date, and ones the last office left running carry on.
  ctx.building.watchClones(ctx.floorsChanged);
  ctx.building.resumeClones((r) => {
    ctx.floorsChanged();
    if (typeof r === 'string') {
      console.error(`agent-office: ${r}`);
      return ctx.toastAll(`🛗 ${r}`, 'warn');
    }
    if (!openFloor(r)) return;
    console.log(`  the ${r.name} floor's clone finished (${r.dir})`);
    ctx.toastAll(`🛗 New floor: ${r.name}, added by ${r.addedBy}`);
  });
  const { registry, remoteFloors, building, toFloor, floorsChanged } = ctx;
  registry.floorsFor = (hostId) =>
    building
      .list()
      .filter((d) => d.host === hostId)
      .map((d) => ({ id: d.id, dir: d.dir, name: d.name }));
  // Where a machine's answers and events go: the proxy for the floor they are about. A machine tells
  // us a floor is gone through `leave`, and the socket closing is handled per floor by the registry.
  registry.onUpward = (floorId, msg) => {
    const floor = remoteFloors.get(floorId);
    if (!floor) return;
    floor.deliver(msg);
    if (msg.t === 'term.data') {
      const viewers = [...clients.values()].filter((c) => c.peer.floor === floorId && c.attached.has(msg.workerId)).map((c) => c.id);
      floorContext.termData(msg.workerId, msg.data, viewers);
    } else if (msg.t === 'event') {
      const event = msg.msg as ServerMsg;
      if (!event || typeof event.t !== 'string') return;
      if (event.t === 'changes') {
        if (Array.isArray(msg.clients)) floorContext.changes(event.state, msg.clients.filter((id) => clients.get(id)?.peer.floor === floorId));
        return;
      }
      // Room snapshots use `state` on the host wire; browser messages name their payloads.
      const body = msg.msg as { state?: unknown };
      const fields: Record<string, string> = { plan: 'plan', decor: 'items', ball: 'ball', cars: 'cars' };
      const field = fields[event.t];
      const outward = field && body.state !== undefined ? { t: event.t, [field]: body.state } as ServerMsg : event;
      toFloor(floor, outward, msg.droppable);
      if (event.t === 'worker.update' || event.t === 'worker.remove') floorsChanged();
    }
  };
  // A machine arriving or leaving changes what the elevator shows, so the panel is refreshed the same
  // way a worker coming or going refreshes it.
  registry.onFloorGone = (floorId) => {
    // The proxy stops answering at once, so the elevator says offline rather than letting a call wait
    // out its timeout to find out. Its workers stay on the panel, asleep, until someone resumes them.
    remoteFloors.get(floorId)?.onGone(floorId);
    floorsChanged();
  };
  registry.onFloorUp = () => floorsChanged();
  // Workers still running from the last office are back at their desks before anyone walks in.
  await Promise.all([...floors.values()].map((f) => f.ready));
  return { openFloor };
}
