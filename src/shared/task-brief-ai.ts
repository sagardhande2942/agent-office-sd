import { TASK_BRIEF_MAX, type TaskBrief } from './task-brief.js';

export const BRIEF_AI_PROVIDERS = ['claude', 'codex'] as const;
export type BriefAiProvider = typeof BRIEF_AI_PROVIDERS[number];
export type BriefFields = Omit<TaskBrief, 'original'>;
export const BRIEF_FIELDS = ['goal', 'examples', 'constraints', 'acceptance', 'assumptions', 'questions'] as const;
export interface BriefAiRequest { provider: BriefAiProvider; brief: TaskBrief; maxLength: number; context?: string; }
export interface BriefAiOption { id: BriefAiProvider; name: string; available: boolean; reason?: string; }

export function readBriefRequest(value: unknown): BriefAiRequest | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>, b = v.brief as Record<string, unknown> | undefined;
  if (!BRIEF_AI_PROVIDERS.includes(v.provider as BriefAiProvider) || !b || typeof b !== 'object') return;
  if (typeof b.original !== 'string' || !b.original.trim() || b.original.length > TASK_BRIEF_MAX) return;
  if (!BRIEF_FIELDS.every(k => typeof b[k] === 'string' && (b[k] as string).length <= TASK_BRIEF_MAX)) return;
  if (BRIEF_FIELDS.reduce((n, k) => n + (b[k] as string).length, b.original.length) > 40_000) return;
  if (v.context !== undefined && (typeof v.context !== 'string' || v.context.length > TASK_BRIEF_MAX)) return;
  if (typeof v.maxLength !== 'number' || !Number.isInteger(v.maxLength) || v.maxLength < 500 || v.maxLength > TASK_BRIEF_MAX) return;
  return { provider: v.provider as BriefAiProvider, brief: b as unknown as TaskBrief, maxLength: v.maxLength, context: v.context as string | undefined };
}
