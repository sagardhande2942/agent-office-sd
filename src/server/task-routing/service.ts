import { RoutedWorkers } from './workers.js';
import path from 'node:path';
import { existsSync, readFileSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MEETING_SPACE_LIMIT } from '../../shared/meeting-spaces.js';
import type { Floor, FloorContext } from '../floor.js';
import { workflowProblem } from '../../shared/meeting-workflows.js';
import { atomicWrite } from '../knowledge/store.js';
import { TaskBridge, type QueueTask } from './bridge.js';
import { findRoutedMeeting, meetingArtifacts } from './results.js';
import { TeamRouter, type RoutedMeeting } from './router.js';
import type { Meeting } from '../../shared/protocol.js';

interface Config { enabled: boolean; endpoint: string; tokenEnv: string; owner?: string; maxMeetings: number }
const services = new WeakMap<Floor, { close(): void }>();
function config(dir: string): Config | undefined {
  const file = path.join(dir, '.agent-office/task-routing.json');
  if (!existsSync(file)) return;
  const c = JSON.parse(readFileSync(file, 'utf8'));
  if (c.enabled !== true) return;
  if (typeof process.getuid !== 'function' || statSync(file).uid !== process.getuid() || (statSync(file).mode & 0o077))
    throw Error('Task routing requires an operator-owned private config (chmod 600) on a local POSIX floor');
  try { execFileSync('git', ['ls-files', '--error-unmatch', '--', '.agent-office/task-routing.json'], { cwd: dir, stdio: 'ignore' }); throw Error('Task routing config must not be committed'); }
  catch (error) { if ((error as {status?:number}).status !== 1) throw error; }
  if (Object.keys(c).some(k => !['enabled','endpoint','tokenEnv','owner','maxMeetings'].includes(k)) || typeof c.endpoint !== 'string'
    || typeof c.tokenEnv !== 'string' || !/^AGENT_OFFICE_[A-Z0-9_]+$/.test(c.tokenEnv) || c.owner !== undefined && typeof c.owner !== 'string'
    || !Number.isInteger(c.maxMeetings) || c.maxMeetings < 1 || c.maxMeetings > MEETING_SPACE_LIMIT) throw Error('Invalid task routing configuration');
  return c;
}

export function installTaskRouting(floor: Floor, ctx: FloorContext) {
  let lock: string | undefined;
  try {
    const c = config(floor.def.dir); if (!c) return;
    const bridge = new TaskBridge(c.endpoint, floor.id, process.env[c.tokenEnv] ?? '');
    const lockPath = path.join(floor.def.dir, '.agent-office/task-routing.lock');
    mkdirSync(lockPath); lock = lockPath; // A crash leaves an explicit blocker; never steal another controller's lock.
    const mapFile = path.join(floor.def.dir, '.agent-office/task-groups.json');
    const mapping: Record<string, string> = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.values(mapping).some(v => typeof v !== 'string')) throw Error('Invalid task group map; preserve for recovery');
    Object.setPrototypeOf(mapping, null);
    const current = () => floor.meetings.state().spaces!.map(s => s.current).filter((m): m is Meeting => !!m);
    const group = (name: string) => {
      const spaces = floor.meetings.state().spaces!;
      if (mapping[name] && spaces.some(s => s.id === mapping[name])) return mapping[name];
      const label = 'Team: ' + name;
      const old = spaces.find(s => s.name === label);
      if (old) mapping[name] = old.id;
      else {
        const error = floor.meetings.create(label); if (error) throw Error(error);
        mapping[name] = floor.meetings.state().spaces!.find(s => s.name === label)!.id;
      }
      atomicWrite(mapFile, JSON.stringify(mapping)); return mapping[name];
    };
    const deskTasks = new RoutedWorkers(floor,ctx,c.owner);
    let closing = false;
    const allowed = () => closing ? 'Task router is stopping' : !floor.project.branch ? 'Task routing requires a Git floor' : !ctx.mayAct || !ctx.mayAct(c.owner)
      ? 'Task routing requires current local admin authorization; remote autonomous dispatch is not enabled'
      : ctx.ledger.hiringPaused;
    const router = new TeamRouter(path.join(floor.def.dir, '.agent-office/task-routing-state.json'), bridge, {
      allowed,
      available: task => {
        if (task.execution === 'worker') return deskTasks.available();
        if (workflowProblem(task.workflow) || typeof task.group !== 'string' || !task.group.trim() || task.group.length > 100 || ctx.capacity.room() < task.workflow.roles.length) return false;
        const id = group(task.group);
        return floor.meetings.state().spaces!.find(s => s.id === id)?.current?.status !== 'running';
      },
      find: key => deskTasks.find(key) ?? findRoutedMeeting(floor, key),
      retire: async (id, key) => {
        if (deskTasks.find(key)) { await deskTasks.retire(id,key); return; }
        const space = floor.meetings.state().spaces!.find(s => s.current?.id === id && s.current.routingKey === key);
        if (space) { const error = floor.meetings.clear('Task router', space.id); if (error) throw Error(error); }
      },
      start: async (task: QueueTask, key, id) => {
        const refused = allowed(); if (refused) throw Error(refused);
        if (task.execution === 'worker') { await floor.workers.fetchBase(); if (allowed() || !deskTasks.available()) throw Error('Worker capacity or authorization changed'); return deskTasks.start(task,key,id); }
        const bad = workflowProblem(task.workflow); if (bad) throw Error(bad);
        await floor.workers.fetchBase();
        if (allowed() || ctx.capacity.room() < task.workflow.roles.length) throw Error('Authorization or whole-meeting capacity changed');
        const previous = Array.isArray(task.references) ? task.references.filter((id): id is string => typeof id === 'string').slice(0,20) : [];
        const artifacts = meetingArtifacts(floor, previous);
        const prompt = JSON.stringify({ task_id: task.id, input: task.input, previous_artifacts: artifacts.references });
        if (prompt.length > 19000) throw Error('Task packet exceeds meeting brief capacity');
        const error = floor.meetings.start({ pattern: 'custom', workflow: task.workflow, spaceId: group(task.group),
          title: task.title, prompt, roles: [...task.workflow.roles] }, 'Task router', c.owner, { key, id, inputs: artifacts.files });
        if (error) throw Error(error);
        const m = current().find(m => m.routingKey === key); if (!m) throw Error('Meeting start acceptance ambiguous');
        return { id: m.id, key, state: m.status } as RoutedMeeting;
      },
    }, floor.id, c.maxMeetings);
    let polling: Promise<void> | undefined;
    const timer = setInterval(() => { if (!closing && !polling) polling = router.poll().catch(() => { if (!closing) ctx.toast(floor, 'Task routing could not persist its state; inspect storage before retrying.', 'warn'); }).finally(() => { polling = undefined; }); }, 5000); timer.unref();
    const release = () => { try { rmdirSync(lockPath); } catch { /* Retain an explicit recovery blocker if removal fails. */ } };
    services.set(floor, { close() { closing = true; clearInterval(timer); deskTasks.close(); if (polling) void polling.finally(release); else release(); } });
    lock = undefined; // Owned by the installed service until orderly shutdown.
  } catch (error) {
    if (lock) { try { rmdirSync(lock); } catch { /* Another process owns an existing lock. */ } }
    ctx.toast(floor, 'Task routing disabled: ' + (error as Error).message, 'warn');
  }
}
export function closeTaskRouting(floor: Floor) { services.get(floor)?.close(); services.delete(floor); }
