import path from 'node:path';
import type { Floor } from '../floor.js';
import type { WorkerFeature } from '../workers/features.js';
import { workerTeamSession } from '../team-sessions.js';
import { ActivityHeatmapRecorder } from './recorder.js';

const stores = new WeakMap<Floor, { recorder: ActivityHeatmapRecorder; timer: ReturnType<typeof setInterval> }>();

export function getActivityRecorder(floor: Floor): ActivityHeatmapRecorder {
  if (!stores.has(floor)) installActivityHeatmap(floor);
  return stores.get(floor)!.recorder;
}

export function installActivityHeatmap(floor: Floor): WorkerFeature {
  let entry = stores.get(floor);
  if (!entry) {
    const recorder = new ActivityHeatmapRecorder({ file: path.join(floor.dir, '.agent-office', 'activity-heatmap.json') });
    const timer = setInterval(() => {
      try {
        const seen = new Set<string>();
        for (const worker of floor.workers.list()) {
          const state = workerTeamSession(floor, worker.id)?.state();
          for (const run of state ? [...state.past, ...(state.current ? [state.current] : [])] : []) {
            if (!seen.has(run.id)) { seen.add(run.id); recorder.team(run); }
          }
        }
        recorder.checkpoint();
      } catch { /* The next lifecycle update retries persistence without losing in-memory data. */ }
    }, 1000);
    timer.unref();
    entry = { recorder, timer };
    stores.set(floor, entry);
  }
  const recorder = entry.recorder;
  return { update: worker => recorder.update(worker), remove: worker => recorder.remove(worker) };
}

export function closeActivityHeatmap(floor: Floor): void {
  const entry = stores.get(floor);
  if (!entry) return;
  clearInterval(entry.timer);
  for (const worker of floor.workers.list()) entry.recorder.remove(worker);
  entry.recorder.checkpoint();
  stores.delete(floor);
}
