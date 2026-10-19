import type { ActivitySnapshot } from '../../../shared/activity-heatmap';

/** IDs remain filter keys; names are presentation only. Old hosts need no migration. */
export function workerLabels(snapshot: ActivitySnapshot): Map<string, string> {
  const names = new Map<string, string>();
  for (const interval of snapshot.intervals) {
    if (!names.has(interval.workerId)) names.set(interval.workerId, interval.workerId);
    if (interval.workerName?.trim()) names.set(interval.workerId, interval.workerName.trim());
  }
  const counts = new Map<string, number>();
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map([...names].map(([id, name]) => [id, counts.get(name)! > 1 ? `${name} (${id})` : name]));
}
