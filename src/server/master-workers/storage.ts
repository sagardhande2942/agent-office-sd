import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TeamConfig, TeamPreset, TeamRequest, TeamRun } from '../../shared/master-workers.js';
import type { AgentChoice } from '../../shared/protocol.js';
import { validateWorkerModel, validateWorkerEffort } from '../agents.js';
import { planModelIdentity } from '../../shared/plan-providers.js';
import { isAgentProvider } from '../../shared/providers.js';
export function text(value: unknown, label: string, max = 20000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Provide ${label} (1–${max} characters)`);
  return value.trim();
}
export function choice(value: unknown): AgentChoice {
  const a = value as AgentChoice;
  if (!a || !isAgentProvider(a.provider) || a.provider === 'custom' || !a.model) throw Error('Choose a built-in provider and explicit model');
  const error = validateWorkerModel('agent', a.provider, a.model) ?? validateWorkerEffort('agent', a.provider, a.effort);
  if (error) throw Error(error);
  return { provider: a.provider, model: a.model, ...(a.effort ? { effort: a.effort } : {}) };
}
export function config(raw: unknown): TeamConfig {
  const c = raw as TeamConfig;
  if (!c || !Array.isArray(c.models) || !c.models.length || c.models.length > 20) throw Error('Choose 1–20 eligible models');
  if (!Number.isInteger(c.maxWorkers) || c.maxWorkers < 1 || c.maxWorkers > 5) throw Error('Worker limit must be 1–5');
  const models = c.models.map(choice);
  if (new Set(models.map(modelKey)).size !== models.length) throw Error('Eligible model choices must be distinct');
  return { master: choice(c.master), models, maxWorkers: c.maxWorkers };
}
export function request(raw: unknown): TeamRequest {
  const r = raw as TeamRequest;
  if (!Array.isArray(r?.requirements) || !r.requirements.length || r.requirements.length > 100) throw Error('Provide 1–100 requirements');
  return { ...config(r), brief: text(r.brief, 'task brief'), requirements: r.requirements.map(v => text(v, 'requirement', 2000)), constraints: r.constraints === undefined || r.constraints === '' ? '' : text(r.constraints, 'constraints') };
}
export function modelKey(a: AgentChoice): string { return planModelIdentity(a.provider,a.model); }
export function save(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, file);
}
export function load<T>(file: string, fallback: T): T {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : fallback;
}
export class TeamPresets {
  private presets: TeamPreset[] = [];
  error?: string;
  constructor(private file: string) {
    try { const saved = load<unknown>(file, []); if (!Array.isArray(saved)) throw Error('Invalid preset file'); this.presets = saved.map(p => ({ ...config(p), id: text(p.id, 'preset ID', 80), name: text(p.name, 'preset name', 100) })); }
    catch (e) { this.error = `Cannot read team presets: ${(e as Error).message}`; }
  }
  state() { return structuredClone(this.presets); }
  edit(preset?: TeamPreset, remove?: string) {
    if (this.error) throw Error(this.error);
    let next = [...this.presets];
    if (remove) next = next.filter(p => p.id !== remove);
    else if (preset) {
      const p = { ...config(preset), id: text(preset.id, 'preset ID', 80), name: text(preset.name, 'preset name', 100) };
      next = next.filter(v => v.id !== p.id); next.push(p);
    } else throw Error('Provide a preset or ID to delete');
    if (next.length > 100) throw Error('At most 100 presets');
    save(this.file, next); this.presets = next;
  }
}
export function restored(raw: unknown): { current: TeamRun | null; past: TeamRun[] } {
  const value = raw as { current: TeamRun | null; past: TeamRun[] };
  if (!value || !Array.isArray(value.past)) throw Error('Invalid activity file');
  for (const r of [...value.past, ...(value.current ? [value.current] : [])]) {
    request(r); text(r.id, 'activity ID', 80);
    if (!Array.isArray(r.tasks) || !Array.isArray(r.workers) || !r.notifications || !Number.isInteger(r.revision) || !['starting','running','paused','stopped','done'].includes(r.phase)) throw Error('Invalid saved activity');
    if (r.tasks.length>100 || r.workers.length>1000 || value.past.length>10) throw Error('Invalid saved activity limits');
    for(const w of r.workers){text(w.workerId,'worker ID',80);choice(w.choice);}
    for(const t of r.tasks){
      text(t.id,'task ID',80);text(t.title,'title',240);text(t.instructions,'instructions');text(t.acceptance,'acceptance');
      if(!Array.isArray(t.files)||!Array.isArray(t.dependencies)||!Array.isArray(t.attempts)||t.attempts.length>2||!['pending','running','review','takeover','done'].includes(t.status))throw Error('Invalid saved task');
      for(const a of t.attempts){choice(a.choice);if(typeof a.workerId!=='string'||!['running','submitted','failed','rejected','accepted'].includes(a.status)||!Array.isArray(a.commits??[]))throw Error('Invalid saved attempt');}
    }
  }
  return value;
}
