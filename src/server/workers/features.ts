import type { WorkerInfo } from '../../shared/protocol.js';
import type { WorkerEvents } from './types.js';

/** Floor features join worker prompts and lifecycle notifications through this registry. */
export interface WorkerFeature {
  prompt?(worker: WorkerInfo, text: string | undefined): string | undefined;
  update?(worker: WorkerInfo): void;
  remove?(worker: WorkerInfo): void;
}

export function featurePrompt(events: WorkerEvents, worker: WorkerInfo, text: string | undefined): string | undefined {
  for (const feature of events.features ?? []) {
    try { text = feature.prompt?.(worker, text) ?? text; }
    catch { events.toast('Worker context could not be loaded; continuing with the task brief.', 'warn'); }
  }
  return text;
}

export function featureEvent(events: WorkerEvents, kind: 'update' | 'remove', worker: WorkerInfo): void {
  for (const feature of events.features ?? []) {
    try { feature[kind]?.(worker); }
    catch { events.toast('Worker knowledge could not be saved to disk; it will be retried on the next update.', 'warn'); }
  }
}
