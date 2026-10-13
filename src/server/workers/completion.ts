import { readCompletion } from '../completion.js';
import type { WorkerContext } from './types.js';
export function submitCompletion(ctx: Pick<WorkerContext, 'workers' | 'emit' | 'persist' | 'events'>, id: string, body: unknown, branch?: string): string | undefined {
  const w = ctx.workers.get(id);
  if (!w || w.info.kind !== 'agent' || w.info.helper) return 'Only a regular agent can submit its completion checklist';
  try {
    const report = readCompletion(body, w.info.completionRevision ?? 0);
    const enriched = { ...report, branch: w.info.worktree?.branch ?? branch, task: w.info.task?.name ?? w.info.prompt };
    for (const feature of ctx.events.features ?? []) { const error = feature.completion?.(w.info, enriched); if (error) return error; }
    w.info.completion = enriched;
    ctx.emit(w); ctx.persist();
  } catch (err) { return (err as Error).message; }
}
