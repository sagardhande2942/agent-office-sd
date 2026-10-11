import path from 'node:path';
import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { TeamAction } from '../../shared/master-workers.js';
import type { FromFloor } from '../../shared/floorhost.js';
import { Communications } from '../communications.js';
import { createTeam } from './runtime.js';
import { TeamPresets, request } from './storage.js';
import type { TeamCoordinator } from './coordinator.js';
import { readBody, send } from '../http/util.js';
import { floorCompletion } from '../hooks/completion.js';
import { floorCommunications } from '../hooks/communications.js';
import { WORKER_FEATURE_PATHS, floorWorkerFeatureHook } from '../hooks/worker-features.js';
export const TEAM_HOST_CALLS = new Set(['master-workers.start', 'master-workers.control', 'master-workers.capacity']);
const allowed = new Set(['/office/workers', '/office/workers/inbox', '/office/workers/request', '/office/workers/reply', '/office/workers/ack', '/office/workers/completion', '/office/workers/complete', ...WORKER_FEATURE_PATHS]);
/** The existing coordinator executes against host-local worktrees and agent sign-ins. */
export class HostTeams {
  private budgets = new Map<string, { limit: number | null; paused?: string }>();
  private runs = new Map<string, TeamCoordinator>();
  private ledgers = new Map<string, Communications>();
  private presets?: TeamPresets;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private dataDir: () => string, private floors: Map<string, Floor>, private emit: (m: FromFloor) => void, private beforeSpawn: () => void = () => {}) {}
  team(floor: Floor): TeamCoordinator {
    let run = this.runs.get(floor.id); if (run) return run;
    this.presets ??= new TeamPresets(path.join(this.dataDir(), 'master-workers-presets.json'));
    run = createTeam(floor, this.presets, () => {
      const active = this.runs.get(floor.id);
      if (active) this.emit({ t: 'event', floorId: floor.id, seq: 0, msg: { t: 'master-workers', state: active.state() } });
    }, () => {
      this.beforeSpawn();
      const budget = this.budgets.get(floor.id);
      if (budget?.paused) throw Error(budget.paused);
      if (!budget || (budget.limit !== null && floor.workers.list().length >= budget.limit)) throw Error('The office is at its worker limit; wait for capacity');
    });
    this.runs.set(floor.id, run); return run;
  }
  report(floor: Floor) { this.emit({ t: 'event', floorId: floor.id, seq: 0, msg: { t: 'master-workers', state: this.team(floor).state() } }); }
  state(floor: Floor) { return this.team(floor).state(); }
  startClock() {
    if (this.timer) return;
    this.timer = setInterval(() => { for (const run of this.runs.values()) void run.tick().catch(() => {}); }, 2000);
    this.timer.unref();
  }
  close() { clearInterval(this.timer); this.timer = undefined; this.runs.clear(); this.ledgers.clear(); this.budgets.clear(); }
  async call(floor: Floor, msg: Record<string, unknown>) {
    if (Object.hasOwn(msg, 'budget')) {
      if (msg.budget !== null && (typeof msg.budget !== 'number' || !Number.isInteger(msg.budget) || msg.budget < 0 || msg.budget > 10000)) return 'Invalid team capacity';
      this.budgets.set(floor.id, { limit: msg.budget as number | null, ...(typeof msg.paused === 'string' ? { paused: msg.paused.slice(0, 1000) } : {}) });
    }
    if (msg.t === 'master-workers.capacity') return undefined;
    if (msg.owner !== undefined && typeof msg.owner !== 'string') return 'Invalid activity owner';
    if (msg.t === 'master-workers.start') {
      const r = request(msg.request);
      if (!floor.project.branch) return 'Master / Workers requires a Git project';
      if ([r.master, ...r.models].some(a => !floor.project.agentProviders.includes(a.provider))) return 'Select providers installed on the floor host';
      await floor.workers.fetchBase();
      if (this.floors.get(floor.id) !== floor) return 'The floor closed while preparing its Git base';
      this.team(floor).start(r, msg.owner as string | undefined);
    } else {
      if (!['pause', 'resume', 'stop'].includes(String(msg.action))) return 'Unknown control';
      this.team(floor).control(msg.action as 'pause' | 'resume' | 'stop', msg.owner as string | undefined);
    }
    this.report(floor); return undefined;
  }
  async hook(req: http.IncomingMessage, res: http.ServerResponse, url: URL, floorOf: (id: string) => Floor | undefined): Promise<boolean> {
    if (!url.pathname.startsWith('/office/')) return false;
    const id = url.searchParams.get('worker') ?? '', floor = floorOf(id);
    const actor = floor?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    const endpoint = url.pathname === '/office/team';
    if (!actor || !floor) { if (endpoint) { send(res, 401, { error: 'Send your worker ID and hook token' }); return true; } return false; }
    const run = this.team(floor), role = run.member(id) ?? actor.masterWorkers?.role;
    if (endpoint) {
      try {
        if (!role) throw Error('Not a participant in this activity');
        if (req.method === 'GET') send(res, 200, run.state());
        else if (req.method === 'POST') send(res, 200, await run.action(id, JSON.parse(await readBody(req)) as TeamAction));
        else send(res, 405, { error: 'Use GET state or POST action' });
      } catch (e) { send(res, 400, { error: (e as Error).message }); }
      return true;
    }
    if (!role) return false;
    if (!allowed.has(url.pathname) || (url.pathname === '/office/workers' && req.method !== 'GET')) {
      send(res, 403, { error: 'Team participants use team actions; ordinary hiring, PR management and unrelated office operations are disabled' }); return true;
    }
    try {
      if (await floorWorkerFeatureHook(floor, req, res, url, msg => this.emit({ t: 'event', floorId: floor.id, seq: 0, msg }))) return true;
      if (['/office/workers/completion', '/office/workers/complete'].includes(url.pathname)) await floorCompletion(floor, req, res, url);
      else if (url.pathname === '/office/workers') send(res, 200, { floor: { id: floor.id, name: floor.def.name }, you: id, workers: floor.workers.list() });
      else {
        let ledger = this.ledgers.get(floor.id);
        if (!ledger) { ledger = new Communications(path.join(floor.dir, '.agent-office', 'team-inbox')); this.ledgers.set(floor.id, ledger); }
        await floorCommunications(floor, ledger, req, res, url);
      }
    } catch (e) { send(res, 400, { error: (e as Error).message }); }
    return true;
  }
}
