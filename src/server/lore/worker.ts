import { createHash } from 'node:crypto';
import type { WorkerInfo, ServerMsg } from '../../shared/protocol.js';
import type { LoreNote } from '../../shared/protocol/lore.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import { cleanLoreTitle, LORE_TITLE_MAX, LORE_CONTENT_MAX, LORE_TAGS_MAX, LORE_TAG_MAX } from '../../shared/lore.js';
import { workerLoreContext, WORKER_LORE_INSTRUCTIONS } from '../../shared/worker-lore.js';
import type { LoreStore } from '../lore.js';
import type { WorkerFeature } from '../workers/features.js';

const key = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const snippet = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const regular = (worker: WorkerInfo) => worker.kind === 'agent' && !worker.helper && !worker.meeting && !worker.planReview?.locked && !DESK_BY_ID.get(worker.deskId)?.station;
type Memory = Pick<LoreStore, 'list' | 'save'>;

/** The worker identity and note ID are server-owned, never supplied by the request. */
export function saveWorkerKnowledge(memory: Memory, worker: WorkerInfo, body: unknown): LoreNote {
  if (!regular(worker)) throw new Error('Only coding workers may record repository discoveries');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a lore note object');
  const draft = body as Record<string, unknown>;
  if (Object.keys(draft).some(k => !['title', 'content', 'tags'].includes(k))) throw new Error('Lore accepts title, content and tags; worker identity and IDs are assigned by the server');
  if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > LORE_TITLE_MAX) throw new Error(`title must be 1–${LORE_TITLE_MAX} characters`);
  if (typeof draft.content !== 'string' || !draft.content.trim() || draft.content.length > LORE_CONTENT_MAX) throw new Error(`content must be 1–${LORE_CONTENT_MAX} characters`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(draft.title + draft.content)) throw new Error('Lore notes cannot contain terminal control characters');
  if (draft.tags !== undefined && (!Array.isArray(draft.tags) || draft.tags.length > LORE_TAGS_MAX || draft.tags.some(t => typeof t !== 'string' || !t.length || t.length > LORE_TAG_MAX || !/^[a-zA-Z0-9_-]+$/.test(t)))) throw new Error('tags must be up to eight short letters/digits/underscore/hyphen tags');
  const title = cleanLoreTitle(draft.title);
  return memory.save({ id: `knowledge-${key(title.toLowerCase())}`, title, content: draft.content, author: worker.name,
    workerId: worker.id, desk: DESK_BY_ID.get(worker.deskId)?.label ?? worker.deskId, tags: draft.tags as string[] | undefined });
}

/** Capture checklists once per submission, with stable IDs across restarts and report corrections. */
export function workerLore(memory: LoreStore, publish: (msg: ServerMsg) => void): WorkerFeature {
  const captured = new Map<string, string>();
  function handover(worker: WorkerInfo, leaving = false) {
    if (!regular(worker)) return;
    const report = worker.completion?.revision === (worker.completionRevision ?? 0) ? worker.completion : undefined;
    if (!report && (!leaving || !(worker.prompt || worker.task))) return;
    const revision = worker.completionRevision ?? 0;
    const id = `handover-${key(`${worker.id}:${revision}`)}`;
    const signature = JSON.stringify(report ?? { prompt: worker.prompt, task: worker.task, status: worker.status });
    if (captured.get(worker.id) === `${id}:${signature}`) return;
    const evidenceLimit = report ? Math.max(60, Math.min(1000, Math.floor(5500 / report.checks.length) - 140)) : 0;
    const content = report ? [
      'Automatic shift handover. Evidence below is worker-reported, not independent verification.',
      `Task: ${snippet(report.task ?? worker.task?.name ?? worker.prompt ?? 'Coding task', 240)}`,
      `Summary: ${snippet(report.summary, 1600)}`,
      `Checklist status: ${report.status}`,
      ...report.checks.map(c => `${c.status.toUpperCase()}: ${snippet(c.name, 120)} — ${snippet(c.evidence, evidenceLimit)}`),
      `Files: ${snippet(report.files.join(', ') || report.filesNote || 'No files reported', 500)}`,
      `PR: ${snippet(report.pr ?? report.prNote ?? 'No PR reported', 1000)}`,
      ...(report.branch ? [`Branch: ${snippet(report.branch, 240)}`] : []),
      ...(report.commit ? [`Commit: ${report.commit}`] : []),
    ].join('\n') : `Automatic departure handover. No completion checklist was submitted; completion is unverified.\nTask: ${snippet(worker.task?.name ?? worker.prompt ?? 'Coding task', 1600)}\nStatus at departure: ${worker.status}\nBranch: ${snippet(worker.worktree?.branch ?? 'project checkout', 240)}`;
    const note = memory.save({ id, title: `Handover: ${worker.task?.name ?? worker.prompt ?? worker.name}`,
      content, author: worker.name, workerId: worker.id, desk: DESK_BY_ID.get(worker.deskId)?.label ?? worker.deskId,
      tags: ['handover', 'automatic', ...(!report || report.status === 'needs-attention' ? ['needs-attention'] : [])] });
    captured.set(worker.id, `${id}:${signature}`);
    publish({ t: 'lore.saved', note });
  }
  return {
    prompt(worker, text) {
      if (!regular(worker) || (!text && !worker.prompt)) return text;
      return `${text ?? ''}${WORKER_LORE_INSTRUCTIONS}${workerLoreContext(memory.list(), text ?? worker.prompt ?? '')}`;
    },
    update: worker => handover(worker),
    remove: worker => { handover(worker, true); captured.delete(worker.id); },
  };
}
