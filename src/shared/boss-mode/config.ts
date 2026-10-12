import type { AgentChoice } from '../protocol.js';
import { isAgentProvider } from '../providers.js';
import { BOSS_CATEGORIES, type BossConfig, type BossState } from './types.js';
export function bossDefaults(choice: AgentChoice = { provider: 'claude' }): BossConfig {
  return { mission: '', constraints: '', roadmap: '', initiativePolicy: 'mission', categories: [...BOSS_CATEGORIES],
    boss: choice, workerMode: 'pool', models: [choice], maxWorkers: 3, delivery: 'pr', mergeLabel: 'boss-automerge',
    runtimeMinutes: 120, dailyStarts: 10, recoveryAttempts: 2, maxOpenPrs: 3, discoveryMinutes: 5, autoRecover: true, checks: [] };
}
export function bossInitial(choice?: AgentChoice): BossState {
  return { version: 1, revision: 0, config: bossDefaults(choice), enabled: false, draining: false, phase: 'off',
    message: 'Configure a mission, then turn Boss mode on.', backlog: [], events: [], steering: [], checks: [], presets: [],
    day: '', starts: 0, recovery: 0, updatedAt: 0 };
}
function bounded(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw Error('Invalid ' + name);
  return value.trim();
}
export function bossChoice(raw: unknown): AgentChoice {
  const c = raw as AgentChoice;
  if (!c || !isAgentProvider(c.provider) || c.provider === 'custom') throw Error('Choose an installed built-in provider');
  return { provider: c.provider, ...(c.model ? { model: bounded(c.model, 'model', 240) } : {}), ...(c.effort ? { effort: bounded(c.effort, 'effort', 80) } : {}) } as AgentChoice;
}
export const choiceKey = (c: AgentChoice) => JSON.stringify([c.provider, c.model ?? '', c.effort ?? '']);
export function validateBossConfig(raw: unknown): BossConfig {
  const c = raw as BossConfig;
  if (!c || !['roadmap','mission','explore'].includes(c.initiativePolicy) || !['pool','slots'].includes(c.workerMode) || !['pr','merge'].includes(c.delivery)) throw Error('Invalid Boss configuration');
  const number = (key: keyof BossConfig, min: number, max: number) => { const n = c[key]; if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw Error(String(key) + ' must be ' + min + '–' + max); return n; };
  if (!Array.isArray(c.models) || !c.models.length || c.models.length > (c.workerMode === 'slots' ? 10 : 20)) throw Error('Choose 1–10 worker slots or 1–20 pool choices');
  if (!Array.isArray(c.categories) || !c.categories.length || c.categories.some(v => !BOSS_CATEGORIES.includes(v))) throw Error('Select valid work categories');
  if (!Array.isArray(c.checks) || c.checks.length > 20 || c.checks.some(v => typeof v !== 'string' || !v.trim() || v.length > 1000)) throw Error('Provide up to 20 verification commands');
  if (typeof c.autoRecover !== 'boolean') throw Error('Invalid recovery preference');
  const models = c.models.map(bossChoice);
  if (c.workerMode === 'pool' && new Set(models.map(choiceKey)).size !== models.length) throw Error('Remove duplicate pool choices');
  const maxWorkers = number('maxWorkers', 1, 10);
  if (c.workerMode === 'slots' && models.length > maxWorkers) throw Error('Worker slots exceed the configured maximum');
  return { mission: bounded(c.mission,'mission',20000), constraints: bounded(c.constraints,'constraints',20000), roadmap: bounded(c.roadmap,'roadmap',20000),
    initiativePolicy:c.initiativePolicy, categories:[...new Set(c.categories)], boss:bossChoice(c.boss), workerMode:c.workerMode, models, maxWorkers,
    delivery:c.delivery, mergeLabel:bounded(c.mergeLabel,'merge label',100,c.delivery==='merge'), runtimeMinutes:number('runtimeMinutes',5,1440),
    dailyStarts:number('dailyStarts',1,1000), recoveryAttempts:number('recoveryAttempts',0,10), maxOpenPrs:number('maxOpenPrs',1,100),
    discoveryMinutes:number('discoveryMinutes',1,1440), autoRecover:c.autoRecover, checks:c.checks.map(v=>v.trim()) };
}
