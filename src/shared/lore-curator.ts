import { providerMeta } from './providers.js';
export const CURATOR_PROVIDERS = ['claude', 'codex'] as const;
export type CuratorProvider = typeof CURATOR_PROVIDERS[number];
export type KnowledgeStatus = 'active' | 'needs-verification' | 'archived' | 'superseded';
export interface CurationMeta { status: KnowledgeStatus; reason: string; sources: string[]; checkedAt: number }
declare module './protocol/lore.js' { interface LoreNote { curation?: CurationMeta } }
export interface CuratorSettings {
  enabled: boolean; paused: boolean; afterCompletion: boolean;
  schedule: 'interval' | 'daily'; intervalMinutes: number; dailyTime: string; timezone: string;
  provider: CuratorProvider; model?: string; maxNotes: number;
}
export const DEFAULT_CURATOR_SETTINGS: CuratorSettings = { enabled: false, paused: false, afterCompletion: true,
  schedule: 'interval', intervalMinutes: 360, dailyTime: '02:00', timezone: 'UTC', provider: 'claude', maxNotes: 20 };
export interface CuratorRun { id: string; startedAt: number; finishedAt?: number; trigger: string; provider: CuratorProvider; model?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled'; summary: string; changed: number; skipped: number;
  decisions?: { id: string; before: KnowledgeStatus; after: KnowledgeStatus; reason: string }[] }
export interface CuratorState { settings: CuratorSettings; nextRunAt?: number; retryAt?: number; pending: number; running: boolean;
  providers: CuratorProvider[]; runs: CuratorRun[]; notes: { id: string; title: string; status: KnowledgeStatus; reason: string; sources: string[]; revisions: number }[] }
export type CuratorClientMsg = { t: 'curator.get' } | { t: 'curator.configure'; settings: CuratorSettings }
  | { t: 'curator.run' } | { t: 'curator.pause'; paused: boolean } | { t: 'curator.restore'; id: string; revision?: number } | { t: 'curator.history'; id: string };
export type CuratorServerMsg = { t: 'curator.state'; floor: string; state: CuratorState } | { t: 'curator.history'; floor: string; id: string; revisions: { revision: number; note: import('./protocol/lore.js').LoreNote }[] };
export function validateCuratorSettings(value: unknown): CuratorSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid curator settings');
  const v = value as CuratorSettings;
  if (Object.keys(v).some(k => !Object.hasOwn(DEFAULT_CURATOR_SETTINGS, k) && k !== 'model')) throw Error('Unknown curator setting');
  if (![v.enabled, v.paused, v.afterCompletion].every(x => typeof x === 'boolean')) throw Error('Invalid curator switches');
  if (!['interval', 'daily'].includes(v.schedule) || !Number.isInteger(v.intervalMinutes) || v.intervalMinutes < 5 || v.intervalMinutes > 43200) throw Error('Interval must be 5–43200 minutes');
  if (typeof v.dailyTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.dailyTime)) throw Error('Choose a daily time');
  if (typeof v.timezone !== 'string' || v.timezone.length > 100) throw Error('Invalid timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: v.timezone }).format(); } catch { throw Error('Use a valid IANA timezone'); }
  if (!CURATOR_PROVIDERS.includes(v.provider) || (v.model !== undefined && !providerMeta(v.provider)?.validModel?.(v.model))) throw Error('Choose a supported agent and valid model');
  if (!Number.isInteger(v.maxNotes) || v.maxNotes < 2 || v.maxNotes > 50) throw Error('Batch size must be 2–50 notes');
  return { ...v };
}
