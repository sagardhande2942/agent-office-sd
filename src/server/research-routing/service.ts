import path from 'node:path';
import { existsSync, readFileSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Floor, FloorContext } from '../floor.js';
import { researchPattern } from '../../shared/research-patterns.js';
import { atomicWrite } from '../knowledge/store.js';
import { ResearchBridge, type QueueTask } from './bridge.js';
import { findRoutedMeeting, meetingArtifacts } from './results.js';
import { TeamRouter, type RoutedMeeting } from './router.js';
import type { Meeting } from '../../shared/protocol.js';

interface Config { enabled: boolean; endpoint: string; tokenEnv: string; owner?: string; maxMeetings: number }
const services = new WeakMap<Floor, { close(): void }>();
function config(dir: string): Config | undefined {
  const file = path.join(dir, '.agent-office/research-routing.json');
  if (!existsSync(file)) return;
  const c = JSON.parse(readFileSync(file, 'utf8'));
  if (c.enabled !== true) return;
  if (typeof process.getuid !== 'function' || statSync(file).uid !== process.getuid() || (statSync(file).mode & 0o077))
    throw Error('Research routing requires an operator-owned private config (chmod 600) on a local POSIX floor');
  try { execFileSync('git', ['ls-files', '--error-unmatch', '--', '.agent-office/research-routing.json'], { cwd: dir, stdio: 'ignore' }); throw Error('Research routing config must not be committed'); }
  catch (error) { if ((error as {status?:number}).status !== 1) throw error; }
  if (Object.keys(c).some(k => !['enabled','endpoint','tokenEnv','owner','maxMeetings'].includes(k)) || typeof c.endpoint !== 'string'
    || typeof c.tokenEnv !== 'string' || !/^AGENT_OFFICE_[A-Z0-9_]+$/.test(c.tokenEnv) || c.owner !== undefined && typeof c.owner !== 'string'
    || !Number.isInteger(c.maxMeetings) || c.maxMeetings < 1 || c.maxMeetings > 7) throw Error('Invalid research routing configuration');
  return c;
}

export function installResearchRouting(floor: Floor, ctx: FloorContext) {
  let lock: string | undefined;
  try {
    const c = config(floor.def.dir); if (!c) return;
    const bridge = new ResearchBridge(c.endpoint, floor.id, process.env[c.tokenEnv] ?? '');
    const lockPath = path.join(floor.def.dir, '.agent-office/research-routing.lock');
    mkdirSync(lockPath); lock = lockPath; // A crash leaves an explicit blocker; never steal another controller's lock.
    const mapFile = path.join(floor.def.dir, '.agent-office/research-departments.json');
    const mapping: Record<string, string> = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.values(mapping).some(v => typeof v !== 'string')) throw Error('Invalid research department map; preserve for recovery');
    const current = () => floor.meetings.state().spaces!.map(s => s.current).filter((m): m is Meeting => !!m);
    const department = (name: string) => {
      const spaces = floor.meetings.state().spaces!;
      if (mapping[name] && spaces.some(s => s.id === mapping[name])) return mapping[name];
      const label = 'Research: ' + name;
      const old = spaces.find(s => s.name === label);
      if (old) mapping[name] = old.id;
      else {
        const error = floor.meetings.create(label); if (error) throw Error(error);
        mapping[name] = floor.meetings.state().spaces!.find(s => s.name === label)!.id;
      }
      atomicWrite(mapFile, JSON.stringify(mapping)); return mapping[name];
    };
    let closing = false;
    const allowed = () => closing ? 'Research router is stopping' : !floor.project.branch ? 'Research routing requires a Git floor' : !ctx.mayAct || !ctx.mayAct(c.owner)
      ? 'Research routing requires current local admin authorization; remote autonomous dispatch is not enabled'
      : ctx.ledger.hiringPaused;
    const router = new TeamRouter(path.join(floor.def.dir, '.agent-office/research-routing-state.json'), bridge, {
      allowed,
      available: (pattern, name) => {
        const p = researchPattern(pattern); if (!p || pattern !== 'research.' + name || ctx.capacity.room() < p.seats.default) return false;
        const id = department(name);
        return !floor.meetings.state().spaces!.find(s => s.id === id)?.current ||
          floor.meetings.state().spaces!.find(s => s.id === id)!.current!.status !== 'running';
      },
      find: key => findRoutedMeeting(floor, key),
      retire: async (id, key) => {
        const space = floor.meetings.state().spaces!.find(s => s.current?.id === id && s.current.routingKey === key);
        if (space) { const error = floor.meetings.clear('Research router', space.id); if (error) throw Error(error); }
      },
      start: async (task: QueueTask, key, id) => {
        const refused = allowed(); if (refused) throw Error(refused);
        const p = researchPattern(task.pattern); if (!p) throw Error('Unknown research pattern');
        await floor.workers.fetchBase();
        if (allowed() || ctx.capacity.room() < p.seats.default) throw Error('Authorization or whole-meeting capacity changed');
        const previous = Array.isArray(task.input.previous_results) ? task.input.previous_results.map(r => (r as {meeting_id?:string}).meeting_id).filter((id): id is string => typeof id==='string') : [];
        const prompt = JSON.stringify({ task_id: task.id, candidate_id: task.candidate_id, input: task.input, previous_artifacts: meetingArtifacts(floor,previous) });
        if (prompt.length > 19000) throw Error('Research packet exceeds meeting brief capacity');
        const error = floor.meetings.start({ pattern: task.pattern as Meeting['pattern'], spaceId: department(task.department),
          title: task.department + ' / ' + task.candidate_id.slice(0, 8), prompt, roles: [...p.roles].slice(0, p.seats.default) }, 'Research router', c.owner, { key, id });
        if (error) throw Error(error);
        const m = current().find(m => m.routingKey === key); if (!m) throw Error('Meeting start acceptance ambiguous');
        return { id: m.id, key, state: m.status } as RoutedMeeting;
      },
    }, floor.id, c.maxMeetings);
    let polling: Promise<void> | undefined;
    const timer = setInterval(() => { if (!closing && !polling) polling = router.poll().catch(() => { if (!closing) ctx.toast(floor, 'Research routing could not persist its state; inspect storage before retrying.', 'warn'); }).finally(() => { polling = undefined; }); }, 5000); timer.unref();
    const release = () => { try { rmdirSync(lockPath); } catch { /* Retain an explicit recovery blocker if removal fails. */ } };
    services.set(floor, { close() { closing = true; clearInterval(timer); if (polling) void polling.finally(release); else release(); } });
    lock = undefined; // Owned by the installed service until orderly shutdown.
  } catch (error) {
    if (lock) { try { rmdirSync(lock); } catch { /* Another process owns an existing lock. */ } }
    ctx.toast(floor, 'Research routing disabled: ' + (error as Error).message, 'warn');
  }
}
export function closeResearchRouting(floor: Floor) { services.get(floor)?.close(); services.delete(floor); }
