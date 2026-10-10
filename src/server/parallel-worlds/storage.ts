import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorldsRequest, WorldsState } from '../../shared/parallel-worlds.js';
import { isAgentProvider } from '../../shared/providers.js';
import { validateWorkerEffort, validateWorkerModel } from '../agents.js';

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Provide ${label} (1–${max} characters)`);
  return value.trim();
}
export function worldsRequest(raw: unknown): WorldsRequest {
  const r = raw as WorldsRequest;
  if (!r || !Array.isArray(r.approaches) || r.approaches.length !== 3) throw Error('Provide exactly three approaches');
  if (!r.agent || !isAgentProvider(r.agent.provider)) throw Error('Choose an installed agent provider');
  if (r.agent.model !== undefined && (typeof r.agent.model !== 'string' || r.agent.model.length > 200)) throw Error('Invalid model');
  const err = validateWorkerModel('agent', r.agent.provider, r.agent.model) ?? validateWorkerEffort('agent', r.agent.provider, r.agent.effort);
  if (err) throw Error(err);
  const approaches = r.approaches.map(a => ({ name: text(a?.name, 'world name', 40), brief: text(a?.brief, 'approach', 2000) }));
  if (new Set(approaches.map(a => a.name.toLowerCase())).size !== 3) throw Error('Give each world a distinct name');
  return { task: text(r.task, 'a task', 12000), approaches, agent: { provider: r.agent.provider, model: r.agent.model, effort: r.agent.effort } };
}
export class WorldsStorage {
  state: WorldsState = { experiments: [] };
  constructor(private file: string) {
    try {
      if (!existsSync(file)) return;
      const saved = JSON.parse(readFileSync(file, 'utf8')) as WorldsState;
      if (!Array.isArray(saved.experiments) || saved.experiments.length > 30) throw Error('Invalid experiment history');
      for (const e of saved.experiments) {
        worldsRequest({ task: e.task, agent: e.agent, approaches: e.worlds });
        if (!e.id || !/^[0-9a-f]{40}$/.test(e.base) || e.worlds.some(w => !w.id)) throw Error('Invalid saved experiment');
      }
      this.state = saved;
    } catch (e) { this.state.error = `Cannot read parallel worlds: ${(e as Error).message}`; }
  }
  save() {
    if (this.state.error) throw Error(this.state.error);
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
