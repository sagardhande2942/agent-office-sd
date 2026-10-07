import { randomUUID } from 'node:crypto';
import type { TeamRun } from '../../shared/master-workers.js';
import type { ReplayDetails, ReplayEvent, ReplayEventType, ReplayLog } from '../../shared/task-replay.js';
import { REPLAY_EVENT_LIMIT, REPLAY_TEXT_LIMIT } from '../../shared/task-replay.js';
import { recordedText } from './sanitize.js';

export const REPLAY_COMMITS_LIMIT = 20;
export const REPLAY_MISSING_LIMIT = 8;

const TEXT_KEYS = ['instructions', 'message', 'evidence', 'reviewReason', 'reportedChecks', 'verifiedChecks', 'pr'] as const;
const EVENT_TYPES: readonly ReplayEventType[] = ['start', 'plan', 'assignment', 'result', 'blocker', 'retry', 'review', 'integration', 'pause', 'resume', 'stop', 'final-pr'];
const RUN_SCOPED: readonly ReplayEventType[] = ['start', 'plan'];

export interface ReplayInput {
  type: ReplayEventType;
  summary: string;
  participantId?: string;
  taskId?: string;
  details?: ReplayDetails;
}

function buildDetails(raw: ReplayDetails | undefined): ReplayDetails {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let truncated = false;
  for (const key of TEXT_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const cleaned = recordedText(value);
    out[key] = cleaned.text;
    truncated = truncated || cleaned.truncated;
  }
  const commits = (Array.isArray(source.commits) ? source.commits : [])
    .filter((c): c is string => typeof c === 'string' && !!c.trim())
    .map((c) => c.trim().slice(0, 80));
  if (commits.length) out.commits = commits.slice(0, REPLAY_COMMITS_LIMIT);
  const notes: string[] = [];
  if (commits.length > REPLAY_COMMITS_LIMIT) notes.push(`${commits.length - REPLAY_COMMITS_LIMIT} additional commit IDs omitted`);
  if (truncated) notes.push(`text longer than ${REPLAY_TEXT_LIMIT} characters was truncated`);
  const gaps = (Array.isArray(source.missing) ? source.missing : [])
    .filter((m): m is string => typeof m === 'string' && !!m.trim())
    .map((m) => m.trim().slice(0, 300));
  if (gaps.length || notes.length) out.missing = [...gaps.slice(0, Math.max(0, REPLAY_MISSING_LIMIT - notes.length)), ...notes];
  return out as ReplayDetails;
}

function signature(event: ReplayEvent): string {
  const details = event.details as Record<string, unknown>;
  const keys = Object.keys(details)
    .sort()
    .map((key) => `${key}:${JSON.stringify(details[key])}`)
    .join('|');
  return `${event.type}|${event.participantId ?? ''}|${event.taskId ?? ''}|${event.summary}|${keys}`;
}

export function recordEvent(run: TeamRun, input: ReplayInput): ReplayEvent | undefined {
  const log: ReplayLog = run.replay ?? (run.replay = { events: [], dropped: 0 });
  const event: ReplayEvent = {
    id: randomUUID(),
    timestamp: Date.now(),
    activityId: run.id,
    type: input.type,
    summary: recordedText(input.summary).text || input.type,
    details: buildDetails(input.details),
    ...(input.participantId ? { participantId: String(input.participantId).slice(0, 80) } : {}),
    ...(input.taskId ? { taskId: String(input.taskId).slice(0, 80) } : {}),
  };
  const key = signature(event);
  const last = log.events[log.events.length - 1];
  const duplicate = RUN_SCOPED.includes(input.type)
    ? log.events.some((e) => signature(e) === key)
    : !!last && signature(last) === key;
  if (duplicate) return undefined;
  log.events.push(event);
  while (log.events.length > REPLAY_EVENT_LIMIT) {
    log.events.shift();
    log.dropped++;
  }
  return event;
}

export function normalizeLog(raw: unknown, activityId: string): ReplayLog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { events: [], dropped: 0, historical: true };
  const source = raw as Partial<ReplayLog>;
  let dropped = typeof source.dropped === 'number' && Number.isFinite(source.dropped) && source.dropped > 0 ? Math.floor(source.dropped) : 0;
  const events: ReplayEvent[] = [];
  for (const item of Array.isArray(source.events) ? source.events : []) {
    const event = restoreEvent(item, activityId);
    if (event) events.push(event);
    else dropped++;
  }
  while (events.length > REPLAY_EVENT_LIMIT) {
    events.shift();
    dropped++;
  }
  return { events, dropped, ...(source.historical === true ? { historical: true } : {}) };
}

function restoreEvent(item: unknown, activityId: string): ReplayEvent | null {
  if (!item || typeof item !== 'object') return null;
  const stored = item as Partial<ReplayEvent>;
  if (typeof stored.timestamp !== 'number' || !Number.isFinite(stored.timestamp)) return null;
  if (typeof stored.type !== 'string' || !EVENT_TYPES.includes(stored.type as ReplayEventType)) return null;
  if (typeof stored.summary !== 'string' || !stored.summary.trim()) return null;
  return {
    id: typeof stored.id === 'string' && stored.id ? stored.id.slice(0, 80) : randomUUID(),
    timestamp: stored.timestamp,
    activityId,
    type: stored.type as ReplayEventType,
    summary: recordedText(stored.summary).text,
    details: buildDetails(stored.details),
    ...(stored.participantId ? { participantId: String(stored.participantId).slice(0, 80) } : {}),
    ...(stored.taskId ? { taskId: String(stored.taskId).slice(0, 80) } : {}),
  };
}
