import { readCompletion } from '../completion.js';
import type { WorkerContext } from './types.js';
export function submitCompletion(ctx: Pick<WorkerContext, 'workers' | 'emit' | 'persist'>, id: string, body: unknown, branch?: string): string | undefined {
  const w = ctx.workers.get(id);
  if (!w || w.info.kind !== 'agent' || w.info.helper) return 'Only a regular agent can submit its completion checklist';
  try {
    const report = readCompletion(body, w.info.completionRevision ?? 0);
    w.info.completion = { ...report, branch: w.info.worktree?.branch ?? branch, task: w.info.task?.name ?? w.info.prompt };
    ctx.emit(w); ctx.persist();
  } catch (err) { return (err as Error).message; }
}
