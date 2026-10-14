import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ACTIVITY_INTERVAL_LIMIT, ACTIVITY_PHASES, type ActivityInterval, type ActivityPhase, type ActivitySnapshot } from '../../shared/activity-heatmap.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { TeamRun } from '../../shared/master-workers.js';

type Context = Pick<ActivityInterval, 'activityId' | 'taskId' | 'attempt'> & { review: boolean; running: boolean; paused: boolean };
export interface RecorderOptions { file: string; now?: () => number; maxIntervals?: number; maxAgeMs?: number; }

/** One instance per floor. Synchronous atomic replacement keeps transitions ordered. */
export class ActivityHeatmapRecorder {
  private data: ActivitySnapshot;
  private workers = new Map<string, Pick<WorkerInfo, 'id' | 'status' | 'kind' | 'suspended' | 'sessionId' | 'completionRevision'>>();
  private contexts = new Map<string, Context>();
  private signals = new Map<string, 'implementation' | 'checks'>();
  private removed = new Set<string>();
  private clock: () => number;
  private limit: number;
  private age: number;

  constructor(private options: RecorderOptions) {
    this.clock = options.now ?? Date.now;
    this.limit = Math.max(1, options.maxIntervals ?? ACTIVITY_INTERVAL_LIMIT);
    this.age = Math.max(1, options.maxAgeMs ?? 7 * 86400000);
    const now = this.clock();
    this.data = { version: 1, now, intervals: [], coverage: { since: now, lastObservedAt: now, dropped: 0, historical: true, gaps: [], unavailable: { implementation: 'Only explicit tool start/end signals are measured; other working time is unknown.', checks: 'Only explicit check start/end signals are measured; reported check text supplies no duration.' } } };
    try { this.restore(JSON.parse(readFileSync(options.file, 'utf8')), now); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.data.coverage.historical = true; }
    this.checkpoint();
  }

  update(worker: WorkerInfo): void {
    this.removed.delete(worker.id);
    this.workers.set(worker.id, { id: worker.id, status: worker.status, kind: worker.kind, suspended: worker.suspended, sessionId: worker.sessionId, completionRevision: worker.completionRevision });
    if (worker.status !== 'working') this.signals.delete(worker.id);
    this.reconcile(worker.id);
    this.checkpoint();
  }

  remove(worker: Pick<WorkerInfo, 'id'>): void {
    this.transition(worker.id, null);
    this.workers.delete(worker.id);
    this.contexts.delete(worker.id);
    this.signals.delete(worker.id);
    this.removed.add(worker.id);
    this.checkpoint();
  }

  /** Explicit measured tool boundary; never use the sticky WorkerInfo.action hint. */
  signal(workerId: string, phase: 'implementation' | 'checks' | null): void {
    if (phase) this.signals.set(workerId, phase); else this.signals.delete(workerId);
    this.reconcile(workerId);
    this.checkpoint();
  }

  team(run: TeamRun): void {
    const affected = new Set<string>();
    for (const [id, ctx] of this.contexts) if (ctx.activityId === run.id) { affected.add(id); this.contexts.delete(id); }
    if (run.masterId) {
      affected.add(run.masterId);
      if (run.phase !== 'running') this.signals.delete(run.masterId);
      this.contexts.set(run.masterId, { activityId: run.id, review: false, running: true, paused: run.phase !== 'running' });
    }
    for (const task of run.tasks) task.attempts.forEach((attempt, index) => {
      affected.add(attempt.workerId);
      if (run.phase !== 'running' || attempt.status !== 'running') this.signals.delete(attempt.workerId);
      this.contexts.set(attempt.workerId, { activityId: run.id, taskId: task.id, attempt: index + 1,
        review: task.status === 'review' && attempt.status === 'submitted',
        running: attempt.status === 'running', paused: run.phase !== 'running' });
    });
    for (const id of affected) this.reconcile(id);
    this.checkpoint();
  }

  snapshot(): ActivitySnapshot {
    this.prune(this.time());
    return structuredClone({ ...this.data, now: this.time() });
  }

  /** Heartbeat bounds recovery: elapsed office downtime is never counted as work. */
  checkpoint(): void {
    const now = this.time();
    this.data.now = now;
    this.data.coverage.lastObservedAt = now;
    this.prune(now);
    mkdirSync(dirname(this.options.file), { recursive: true });
    const temp = `${this.options.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(temp, this.options.file);
  }

  private time(): number { return Math.max(this.clock(), this.data.coverage.lastObservedAt); }

  private reconcile(id: string): void {
    const worker = this.workers.get(id), context = this.contexts.get(id);
    let phase: ActivityPhase | null = null;
    if (worker && !this.removed.has(id) && !context?.paused && !worker.suspended && worker.kind !== 'shell') {
      if (worker?.status === 'needs_input') phase = 'waiting';
      else if (context?.review) phase = 'review';
      else if (worker?.status === 'working' && (!context || context.running)) {
        phase = this.signals.get(id) === 'checks' ? 'checks' : (context?.attempt ?? 0) > 1 ? 'retries' : this.signals.get(id) ?? 'unknown';
      }
    }
    this.transition(id, phase, context ?? (worker && (worker.sessionId || worker.completionRevision !== undefined) ? { activityId: worker.sessionId, taskId: `revision-${worker.completionRevision ?? 0}`, attempt: 1, review: false, running: true, paused: false } : undefined));
  }

  private transition(workerId: string, phase: ActivityPhase | null, context?: Context): void {
    const current = this.data.intervals.find(i => i.workerId === workerId && i.end === undefined);
    if (current && current.phase === phase && current.activityId === context?.activityId && current.taskId === context?.taskId && current.attempt === context?.attempt) return;
    const now = this.time();
    if (current) current.end = now;
    if (phase) this.data.intervals.push({ workerId, phase, start: now, ...(context ? { activityId: context.activityId, taskId: context.taskId, attempt: context.attempt } : {}) });
  }

  private prune(now: number): void {
    const cutoff = now - this.age;
    this.data.intervals = this.data.intervals.filter(i => {
      if ((i.end ?? now) < cutoff) { this.data.coverage.dropped++; return false; }
      if (i.start < cutoff) { i.start = cutoff; this.data.coverage.historical = true; }
      return true;
    });
    while (this.data.intervals.length > this.limit) { this.data.intervals.shift(); this.data.coverage.dropped++; }
    this.data.coverage.gaps = this.data.coverage.gaps.filter(g => g.end >= cutoff).slice(-100);
    this.data.coverage.since = Math.max(this.data.coverage.since, cutoff);
  }

  private restore(raw: unknown, now: number): void {
    const value = raw as ActivitySnapshot;
    if (!value || value.version !== 1 || !Array.isArray(value.intervals) || !value.coverage || !Number.isFinite(value.coverage.lastObservedAt) || !Number.isFinite(value.coverage.since)) return;
    const observed = Math.min(now, value.coverage.lastObservedAt);
    this.data.coverage.since = Math.min(now, value.coverage.since);
    this.data.coverage.dropped = Math.max(0, Number.isFinite(value.coverage.dropped) ? value.coverage.dropped : 0);
    for (const interval of value.intervals) {
      if (!interval || typeof interval.workerId !== 'string' || !interval.workerId || interval.workerId.length > 80 || !ACTIVITY_PHASES.includes(interval.phase) || !Number.isFinite(interval.start) || interval.start > observed || (interval.end !== undefined && (!Number.isFinite(interval.end) || interval.end < interval.start))) { this.data.coverage.dropped++; continue; }
      this.data.intervals.push({ workerId: interval.workerId, phase: interval.phase, start: interval.start, end: Math.min(interval.end ?? observed, observed),
        ...(typeof interval.activityId === 'string' ? { activityId: interval.activityId.slice(0, 80) } : {}),
        ...(typeof interval.taskId === 'string' ? { taskId: interval.taskId.slice(0, 80) } : {}),
        ...(Number.isInteger(interval.attempt) && interval.attempt! > 0 ? { attempt: interval.attempt } : {}) });
    }
    this.data.coverage.gaps = (Array.isArray(value.coverage.gaps) ? value.coverage.gaps : []).filter(g => g && Number.isFinite(g.start) && Number.isFinite(g.end) && g.end >= g.start).map(g => ({ start: g.start, end: g.end })).slice(-99);
    if (now > observed) this.data.coverage.gaps.push({ start: observed, end: now });
  }
}
