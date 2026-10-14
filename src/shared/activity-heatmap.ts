/** Observed phase time only; no prompts, commands, terminal output or credentials. */
export const ACTIVITY_PHASES = ['implementation', 'waiting', 'checks', 'retries', 'review', 'unknown'] as const;
export type ActivityPhase = typeof ACTIVITY_PHASES[number];
export const ACTIVITY_INTERVAL_LIMIT = 2000;
export interface ActivityInterval {
  workerId: string;
  activityId?: string;
  taskId?: string;
  attempt?: number;
  phase: ActivityPhase;
  start: number;
  /** Missing only for a currently observed live interval. */
  end?: number;
}
export interface ActivityCoverage {
  since: number;
  lastObservedAt: number;
  dropped: number;
  historical: boolean;
  gaps: { start: number; end: number }[];
  unavailable: Partial<Record<ActivityPhase, string>>;
}
export interface ActivitySnapshot {
  version: 1;
  now: number;
  intervals: ActivityInterval[];
  coverage: ActivityCoverage;
}
export interface ActivityCell {
  workerId: string;
  start: number;
  end: number;
  durations: Record<ActivityPhase, number>;
  live: boolean;
  intervals: ActivityInterval[];
}
export interface ActivityAggregation {
  cells: ActivityCell[];
  totals: Record<ActivityPhase, number>;
  workerTime: number;
  wallTime: number;
  start: number;
  end: number;
  bucketMs: number;
}
export const phaseDurations = (): Record<ActivityPhase, number> => ({ implementation: 0, waiting: 0, checks: 0, retries: 0, review: 0, unknown: 0 });

/** Clip to a window; office wall time is the union across workers, worker time is the sum. */
export function aggregateActivity(snapshot: ActivitySnapshot, options: { start?: number; end?: number; bucketMs?: number; workerId?: string; activityId?: string } = {}): ActivityAggregation {
  const end = Math.min(options.end ?? snapshot.now, snapshot.now);
  const start = options.start ?? Math.max(snapshot.coverage.since, end - 3600000);
  const bucketMs = Math.max(1000, options.bucketMs ?? 60000);
  const totals = phaseDurations(), cells = new Map<string, ActivityCell>();
  const spans: [number, number][] = [];
  for (const interval of snapshot.intervals) {
    if (options.workerId && interval.workerId !== options.workerId || options.activityId && interval.activityId !== options.activityId) continue;
    const a = Math.max(start, interval.start), b = Math.min(end, interval.end ?? snapshot.now);
    if (b <= a) continue;
    totals[interval.phase] += b - a;
    spans.push([a, b]);
    for (let t = start + Math.floor((a - start) / bucketMs) * bucketMs; t < b; t += bucketMs) {
      const stop = Math.min(t + bucketMs, end), key = `${interval.workerId}:${t}`;
      let cell = cells.get(key);
      if (!cell) { cell = { workerId: interval.workerId, start: t, end: stop, durations: phaseDurations(), live: false, intervals: [] }; cells.set(key, cell); }
      cell.durations[interval.phase] += Math.min(b, stop) - Math.max(a, t);
      cell.live ||= interval.end === undefined;
      cell.intervals.push(interval);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let wallTime = 0, last = -Infinity;
  for (const [a, b] of spans) { wallTime += Math.max(0, b - Math.max(a, last)); last = Math.max(last, b); }
  return { cells: [...cells.values()].sort((a, b) => a.workerId.localeCompare(b.workerId) || a.start - b.start), totals, workerTime: Object.values(totals).reduce((a, b) => a + b, 0), wallTime, start, end, bucketMs };
}
