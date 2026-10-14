import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import type { Floor } from '../floor.js';
import { Communications } from '../communications.js';
import { findWorker } from '../office-workers.js';
import { HandoffStore } from './store.js';
import { checks, context, optional, strings, text } from './validation.js';
const ledgers = new WeakMap<Floor, Communications>();
export function handoffInbox(floor: Floor): Communications {
  let ledger = ledgers.get(floor); if (!ledger) { ledger = new Communications(path.join(floor.dir, '.agent-office', 'team-inbox')); ledgers.set(floor, ledger); } return ledger;
}
export function handoffs(floor: Floor, ledger = handoffInbox(floor)) { return new HandoffStore(path.join(floor.dir, '.agent-office'), floor.id, ledger); }
export function codingWorker(worker: WorkerInfo): boolean { return worker.kind === 'agent' && !worker.helper && !worker.meeting && !worker.planReview?.locked && !DESK_BY_ID.get(worker.deskId)?.station; }
export function prefill(floor: Floor, worker: WorkerInfo) {
  const revision = worker.completionRevision ?? 0, report = worker.completion?.revision === revision ? worker.completion : undefined;
  return { revision, taskId: `${worker.id}:${revision}`, goal: (worker.prompt ?? worker.task?.summary ?? worker.task?.name)?.slice(0, 8000),
    completedWork: report?.summary, files: report?.files, filesNote: report?.filesNote, checks: report?.checks,
    context: { branch: worker.worktree?.branch ?? report?.branch ?? floor.project.branch, commit: report?.commit, pr: worker.pr?.url ?? report?.pr, worktree: worker.worktree?.path ?? floor.dir }, evidence: 'worker-reported' };
}
export function executeHandoff(floor: Floor, worker: WorkerInfo, body: Record<string, unknown>, ledger = handoffInbox(floor)): unknown {
  if (!codingWorker(worker)) throw Error('Only same-floor coding workers may use handoff tools');
  const allowed: Record<string, string[]> = { list: [], read: ['id'], prefill: [], accept: ['id'], cancel: ['id'], create: ['key', 'recipient', 'revision', 'taskId', 'goal', 'completedWork', 'nextSteps', 'files', 'filesNote', 'checks', 'questions', 'questionsNote', 'context'] };
  const action = text(body.action, 'action', 20);
  if (!allowed[action]) throw Error('Unknown handoff action');
  if (Object.keys(body).some(k => k !== 'action' && !allowed[action].includes(k))) throw Error('Unknown handoff field; identities and state are server-owned');
  const store = handoffs(floor, ledger), actor = { id: worker.id, name: worker.name };
  if (action === 'list') return { handoffs: store.list() };
  if (action === 'prefill') return prefill(floor, worker);
  if (action === 'read') return { handoff: store.read(text(body.id, 'id', 80)) };
  if (action === 'accept') return { handoff: store.accept(text(body.id, 'id', 80), actor) };
  if (action === 'cancel') return { handoff: store.cancel(text(body.id, 'id', 80), actor) };
  const key = text(body.key, 'key', 80);
  // A successful logical submission remains retryable after the source receives another task.
  const retry = store.retry(worker.id, key, body); if (retry) return { handoff: retry };
  if (!Number.isInteger(body.revision) || body.revision !== (worker.completionRevision ?? 0)) throw Error('Stale task revision; read handoff_prefill before creating');
  const defaults = prefill(floor, worker);
  const taskId = text(body.taskId ?? defaults.taskId, 'task ID', 200);
  if (taskId !== defaults.taskId) throw Error('Source task ID does not match this task revision');
  const recipient = findWorker(floor.workers.list(), text(body.recipient, 'recipient', 100));
  if (typeof recipient === 'string') throw Error(recipient);
  if (!codingWorker(recipient) || recipient.id === worker.id) throw Error('Choose another named same-floor coding worker');
  const files = strings(body.files ?? defaults.files ?? [], 'files', 100, 500), filesNote = optional(body.filesNote ?? defaults.filesNote, 'filesNote');
  const questions = strings(body.questions, 'questions', 30, 2000), questionsNote = optional(body.questionsNote, 'questionsNote');
  if (!files.length && !filesNote) throw Error('Provide changed files or an explicit filesNote explaining none');
  if (!questions.length && !questionsNote) throw Error('Provide unresolved questions or an explicit questionsNote explaining none');
  const suppliedContext = body.context === undefined ? {} : context(body.context);
  // Undefined defaults are omitted before validation.
  const mergedContext = Object.fromEntries(Object.entries({ ...defaults.context, ...suppliedContext }).filter(([, v]) => v !== undefined));
  return { handoff: store.offer({ floorId: floor.id, key, source: actor, recipient: { id: recipient.id, name: recipient.name }, task: { id: taskId, revision: body.revision as number, goal: text(body.goal ?? defaults.goal, 'goal') }, completedWork: text(body.completedWork ?? defaults.completedWork, 'completedWork'), nextSteps: text(body.nextSteps, 'nextSteps'), files, ...(filesNote ? { filesNote } : {}), checks: checks(body.checks ?? defaults.checks), questions, ...(questionsNote ? { questionsNote } : {}), context: context(mergedContext), evidence: 'worker-reported' }, body) };
}
