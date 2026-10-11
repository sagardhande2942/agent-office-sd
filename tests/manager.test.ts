import { startManagerClock } from '../src/server/manager.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALL_MS, blockersOf, managerHash, managerReport, shouldNudge, taskBlocker, verdictOf } from '../src/shared/manager.js';
import { OVERLAP_WORKERS_MAX } from '../src/shared/conflicts.js';
import { workerRow } from '../src/server/office-workers.js';
import type { GhPull, QueueTask, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

const NOW = 1_700_000_000_000;

function worker(id: string, status: WorkerStatus = 'working', more: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id, kind: 'agent', deskId: 'desk-1', name: id, color: '#fff', status, acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [],
    worktree: { path: `.agent-office/worktrees/${id}`, branch: `office/${id}`, base: 'abc' },
    ...more,
  };
}

const pull = (number: number, checks: GhPull['checks'], state = 'OPEN'): GhPull => ({
  number, title: `PR ${number}`, state, isDraft: false, url: `https://github.com/o/r/pull/${number}`, author: '', labels: [], reviewDecision: '',
  headRefName: `office/${number}`, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 1, deletions: 0,
  checks, body: '', closes: [],
});

function task(id: string, more: Partial<QueueTask> = {}): QueueTask {
  return { id, title: `task ${id}`, prompt: `do ${id}`, addedBy: 'Queue agent', addedAt: NOW - 60_000, status: 'queued', provider: 'codex', ...more };
}

/** The report over a floor: rows built the way the server builds them, so the two agree. */
function report(workers: WorkerInfo[], tasks: QueueTask[], pulls: GhPull[], more: Partial<Parameters<typeof managerReport>[0]> = {}) {
  const input = {
    workers,
    tasks,
    pulls,
    rows: workers.map((w) => workerRow(w, { pulls, tasks }, undefined, NOW)),
    floor: { id: 'f1', name: 'Floor one', repo: 'o/r', branch: 'main' },
    maxWorkers: 2,
    freeDesk: 'desk-2' as string | null,
    now: NOW,
    ...more,
  };
  return managerReport(input);
}

test('a worker whose terminal has gone quiet is stalled, and one still printing never is', () => {
  const quiet = worker('mochi', 'working', { lastOutputAt: NOW - STALL_MS - 1 });
  assert.deepEqual(blockersOf(quiet, undefined, NOW), [{ kind: 'stalled', why: 'nothing on its terminal for 10 min', since: quiet.lastOutputAt }]);
  assert.deepEqual(blockersOf(worker('mochi', 'working', { lastOutputAt: NOW - 1000 }), undefined, NOW), []);
  // A worker restored after a restart has no last output at all: it waits on when it started instead.
  assert.deepEqual(blockersOf(worker('mochi', 'working'), undefined, NOW), []);
  assert.deepEqual(blockersOf(worker('mochi', 'working', { workingSince: NOW - STALL_MS - 60_000 }), undefined, NOW).map((b) => b.kind), ['stalled']);
});

test('a worker asking a question, one whose task failed and one that exited are flagged', () => {
  const asking = worker('mochi', 'needs_input', { activity: 'Which one?', waitingSince: NOW - 5000 });
  assert.deepEqual(blockersOf(asking, undefined, NOW), [{ kind: 'needs_input', why: 'Which one?', since: asking.waitingSince }]);
  const failed = task('t1', { status: 'done', outcome: 'failed', error: 'Unknown agent provider', finishedAt: NOW - 1000 });
  assert.deepEqual(blockersOf(worker('mochi', 'done'), failed, NOW), [{ kind: 'failed', why: 'Unknown agent provider', since: failed.finishedAt }]);
  assert.deepEqual(blockersOf(worker('mochi', 'done'), task('t1', { status: 'done', outcome: 'done' }), NOW), []);
  assert.deepEqual(blockersOf(worker('mochi', 'exited', { exitCode: 3 }), undefined, NOW), [{ kind: 'failed', why: 'its process exited with code 3' }]);
  assert.deepEqual(blockersOf(worker('mochi', 'exited'), undefined, NOW), [{ kind: 'failed', why: 'its process exited' }]);
});

test("a worker's worktree deleted outside the office is flagged", () => {
  const lost = worker('mochi', 'idle', { lost: { branch: 'here' } });
  assert.deepEqual(blockersOf(lost, undefined, NOW).map((b) => b.kind), ['worktree_deleted']);
  assert.deepEqual(blockersOf(worker('mochi', 'idle'), undefined, NOW), []);
  // Worst first, whatever order they come in.
  assert.deepEqual(blockersOf(worker('m', 'needs_input', { worktree: { path: 'p', branch: 'b', base: 'a' }, lost: { branch: 'here' }, lastOutputAt: 0 }), undefined, NOW).map((b) => b.kind), ['needs_input', 'worktree_deleted']);
});

test('a waiting task says why it has not started: the limit, no desk, or hiring paused', () => {
  assert.deepEqual(taskBlocker(task('t1'), 2, 'desk-2', 2), { kind: 'over_limit', why: 'the queue is at its limit: 2 of 2 running', since: NOW - 60_000 });
  assert.deepEqual(taskBlocker(task('t1'), 1, null, 2), { kind: 'no_desk', why: 'no desk or bean bag is free', since: NOW - 60_000 });
  assert.deepEqual(taskBlocker(task('t1'), 1, 'desk-2', 2, "today's budget is spent"), { kind: 'hiring_paused', why: "today's budget is spent", since: NOW - 60_000 });
  assert.equal(taskBlocker(task('t1'), 0, 'desk-2', 2), undefined);
  // A task with room and a desk isn't flagged whatever its dependencies: the report lists those instead.
  assert.equal(taskBlocker(task('t1', { dependsOn: ['t0'] }), 0, 'desk-2', 2), undefined);
});

test('a finished task is verified only with a pull request whose checks passed', () => {
  assert.equal(verdictOf(task('t1', { status: 'done', outcome: 'done', pr: { number: 4, url: '', state: 'OPEN', title: '' } }), [pull(4, 'pass')]), 'verified');
  assert.equal(verdictOf(task('t1', { status: 'done', outcome: 'done', pr: { number: 4, url: '', state: 'OPEN', title: '' } }), [pull(4, 'none')]), 'verified');
  for (const checks of ['fail', 'pending'] as const) {
    assert.equal(verdictOf(task('t1', { status: 'done', outcome: 'done', pr: { number: 4, url: '', state: 'OPEN', title: '' } }), [pull(4, checks)]), 'needs-review');
  }
  // A PR the office has never heard the checks of: a person reads it before it's called done.
  assert.equal(verdictOf(task('t1', { status: 'done', outcome: 'done', pr: { number: 4, url: '', state: 'OPEN', title: '' } }), []), 'needs-review');
  assert.equal(verdictOf(task('t1', { status: 'done', outcome: 'exited' }), [pull(4, 'pass')]), 'unverified');
});

test('the report lists every worker with its desk, agent, task, pull request and blockers', () => {
  const tasks = [
    task('t1', { status: 'running', workerId: 'mochi', workerName: 'Mochi', pr: { number: 4, url: 'https://x/4', state: 'OPEN', title: 'Fix' }, startedAt: NOW }),
    task('t2', { status: 'done', outcome: 'done', workerId: 'nico', workerName: 'Nico', pr: { number: 5, url: 'https://x/5', state: 'OPEN', title: 'Tidy' }, finishedAt: NOW - 10_000 }),
  ];
  const workers = [worker('mochi', 'needs_input', { activity: 'Which one?', provider: 'codex', model: 'gpt-6.1-sol' }), worker('nico', 'done')];
  const r = report(workers, tasks, [pull(4, 'pending'), pull(5, 'pass')]);
  assert.equal(r.workers.length, 2);
  assert.deepEqual(r.workers[0].blockers.map((b) => b.kind), ['needs_input']);
  assert.equal(r.workers[0].taskId, 't1');
  assert.equal(r.workers[0].provider, 'codex');
  assert.equal(r.workers[0].pr?.number, 4);
  assert.deepEqual(r.workers[1].blockers, []);
  // The task each worker was seated for, the agent it runs on, and how its work stands.
  assert.deepEqual(r.tasks.map((t) => [t.id, t.status, t.workerName, t.agent.provider]), [
    ['t1', 'running', 'Mochi', 'codex'],
    ['t2', 'done', 'Nico', 'codex'],
  ]);
  assert.equal(r.tasks[1].verification, 'verified');
  assert.equal(r.tasks[1].pr?.checks, 'pass');
  assert.equal(r.tasks[0].verification, undefined);
});

test('the report carries the choices it was built with', () => {
  const r = report([], [], [], { maxWorkers: 3, freeDesk: null, hiringPaused: 'out of budget' });
  assert.deepEqual(r.floor, { id: 'f1', name: 'Floor one', repo: 'o/r', branch: 'main' });
  assert.equal(r.at, NOW);
  assert.deepEqual(r.queue, { maxWorkers: 3, freeDesk: null, hiringPaused: 'out of budget' });
});

test('attention is worst first, and what needs a person is a decision', () => {
  const tasks = [
    task('t1', { status: 'running', workerId: 'quiet', workerName: 'Quiet' }),
    task('t2', { status: 'done', outcome: 'done', finishedAt: NOW - 20_000, pr: { number: 4, url: 'https://x/4', state: 'OPEN', title: 'Fix' } }),
    task('t3', { status: 'done', outcome: 'exited', finishedAt: NOW - 5_000 }),
    task('t4'),
  ];
  const workers = [
    worker('quiet', 'working', { lastOutputAt: NOW - STALL_MS - 1 }),
    worker('asking', 'needs_input', { activity: 'Which one?' }),
  ];
  const r = report(workers, tasks, [pull(4, 'fail')], { maxWorkers: 1 });
  assert.deepEqual(r.attention.map((a) => [a.kind, a.worker?.name ?? a.task?.id]), [
    ['needs_input', 'asking'],
    ['failed', 't2'],
    ['failed', 't3'],
    ['stalled', 'quiet'],
    ['over_limit', 't4'],
  ]);
  assert.deepEqual(r.decisions.map((d) => [d.worker?.name ?? d.task?.id, d.ask]), [
    ['asking', 'answer the question it asked'],
    ['t2', 'read the pull request and its checks before calling the task done'],
    ['t3', 'read the work, or requeue the task with office-queue retry'],
  ]);
  assert.match(r.attention.find((a) => a.task?.id === 't2')!.why, /its checks are fail on PR #4/);
  assert.match(r.attention.find((a) => a.task?.id === 't3')!.why, /no pull request/);
});

test('a task waiting on another says which, until that one finishes done', () => {
  const a = task('t1', { status: 'done', outcome: 'done' });
  const b = task('t2', { status: 'queued', dependsOn: ['t1'] });
  assert.deepEqual(report([], [a, b], []).tasks[1].blockedBy, undefined);
  const c = task('t1', { status: 'done', outcome: 'exited' });
  const held = report([], [c, b], []);
  assert.deepEqual(held.tasks[1].blockedBy, ['task t1']);
  assert.equal(held.tasks[1].blockers, undefined);
  assert.deepEqual(held.ongoing.map((t) => t.id), ['t2']);
});

test('the report groups the floor into completed, ongoing and what a person must decide', () => {
  const tasks = [
    task('t1', { status: 'done', outcome: 'done', finishedAt: NOW - 30_000, pr: { number: 4, url: '', state: 'OPEN', title: '' } }),
    task('t2', { status: 'done', outcome: 'done', finishedAt: NOW - 10_000, pr: { number: 5, url: '', state: 'OPEN', title: '' } }),
    task('t3', { status: 'running', workerId: 'mochi', workerName: 'Mochi' }),
  ];
  const r = report([worker('mochi')], tasks, [pull(4, 'pass'), pull(5, 'pass')]);
  // Newest first.
  assert.deepEqual(r.completed.map((t) => t.id), ['t2', 't1']);
  assert.deepEqual(r.ongoing.map((t) => t.id), ['t3']);
  assert.deepEqual(r.decisions, []);
  assert.equal(r.completed.every((t) => t.verification === 'verified'), true);
});

test('the office nudges the Manager once per change, and only when one is there', () => {
  const empty = managerReport({ workers: [], rows: [], tasks: [], pulls: [], floor: { id: 'f1', name: 'Floor one', branch: 'main' }, maxWorkers: 2, freeDesk: 'desk-1', now: NOW });
  const asking = managerReport({
    workers: [worker('mochi', 'needs_input', { activity: 'Which one?' })], rows: [], tasks: [], pulls: [],
    floor: { id: 'f1', name: 'Floor one', branch: 'main' }, maxWorkers: 2, freeDesk: 'desk-1', now: NOW,
  });
  assert.equal(managerHash(empty), managerHash(empty));
  assert.notEqual(managerHash(empty), managerHash(asking));
  // Something changed and there's a Manager there: prompt it. Then the same hash again: don't.
  assert.equal(shouldNudge(managerHash(empty), managerHash(asking), true), true);
  assert.equal(shouldNudge(managerHash(asking), managerHash(asking), true), false);
  assert.equal(shouldNudge(undefined, managerHash(asking), false), false);
  // A finished task changes what needs telling, whatever its verdict.
  const finished = managerReport({
    workers: [], rows: [], tasks: [task('t1', { status: 'done', outcome: 'done', finishedAt: NOW })], pulls: [],
    floor: { id: 'f1', name: 'Floor one', branch: 'main' }, maxWorkers: 2, freeDesk: 'desk-1', now: NOW,
  });
  assert.notEqual(managerHash(empty), managerHash(finished));
});

test('a worker with no row built for it still reads as a worker', () => {
  const r = managerReport({
    workers: [worker('mochi', 'idle')],
    rows: [],
    tasks: [],
    pulls: [],
    floor: { id: 'f1', name: 'Floor one', branch: 'main' },
    maxWorkers: 1,
    freeDesk: null,
    now: NOW,
  });
  assert.deepEqual([r.workers[0].name, r.workers[0].blockers, r.workers[0].you], ['mochi', [], undefined]);
});

test('the clock finds the manager by its desk, nudges changes once and stops on shutdown', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const manager = worker('manager-worker-id', 'idle', { deskId: 'station-manager' });
  const crew = [manager];
  const prompts: string[] = [];
  const floor = {
    id: 'f1', def: { name: 'Test floor' }, project: { branch: 'main' }, plan: { wing: 0 }, forge: { pulls: { items: [] } },
    queue: { state: () => ({ tasks: [] }), limit: 1 },
    workers: { list: () => crew, deskOccupied: () => false, station: (desk: string) => { prompts.push(desk); } },
  };
  const ctx = { floors: new Map([['f1', floor]]), ledger: {}, anyFloor: () => undefined };
  const stop = startManagerClock(ctx as never);
  t.mock.timers.tick(60_000); assert.deepEqual(prompts, ['station-manager']);
  t.mock.timers.tick(60_000); assert.equal(prompts.length, 1);
  crew.push(worker('blocked', 'needs_input'));
  t.mock.timers.tick(60_000); assert.equal(prompts.length, 2);
  crew.shift();
  t.mock.timers.tick(60_000); assert.equal(prompts.length, 2, 'does not hire an absent manager');
  stop(); crew.unshift(manager);
  t.mock.timers.tick(60_000); assert.equal(prompts.length, 2);
});

// ---- PR conflicts: the office sees a conflict on the list, and says which files fight -------------
//
// `gh pr list` now carries mergeable/mergeStateStatus, so a pull request that cannot merge is a
// blocker on the worker without anyone opening the PR window (see src/shared/conflicts.ts).

/** A pull request GitHub says cannot merge: open, ready, and dirty against its base. */
const conflictingPull = (number: number): GhPull => ({ ...pull(number, 'pass'), headRefName: `office/w${number}`, updatedAt: '2026-01-01T00:00:00Z', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });

/** A worker with an open PR (its branch matches) and, optionally, the files its checklist reported. */
const prWorker = (id: string, pr: number, files?: string[]) => worker(id, 'working', { pr: { number: pr, url: `https://github.com/o/r/pull/${pr}` }, lastOutputAt: NOW, ...(files ? { completion: { revision: 1, summary: 'did it', checks: [], files, submittedAt: NOW, status: 'ready' as const } } : {}) });

test("a worker's pull request conflicting with its base is a blocker, and it reaches attention", () => {
  const w = prWorker('mochi', 4);
  assert.deepEqual(blockersOf(w, undefined, NOW, undefined, [conflictingPull(4)]).map((b) => [b.kind, b.why]), [
    ['conflicting', 'PR #4 conflicts with main and cannot merge until it is resolved'],
  ]);
  const r = report([w], [], [conflictingPull(4)]);
  assert.deepEqual(r.workers[0].blockers.map((b) => b.kind), ['conflicting']);
  assert.deepEqual(r.attention.map((a) => [a.kind, a.worker?.name]), [['conflicting', 'mochi']]);
});

test('a clean, draft, unknown or merged pull request raises no conflicting blocker', () => {
  const w = prWorker('mochi', 4);
  const clean = { ...pull(4, 'pass'), headRefName: 'office/w4', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' } as GhPull;
  assert.deepEqual(blockersOf(w, undefined, NOW, undefined, [clean]), []);
  const unknown = { ...pull(4, 'pass'), headRefName: 'office/w4', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' } as GhPull;
  assert.deepEqual(blockersOf(w, undefined, NOW, undefined, [unknown]), [], 'a forge that will not say is not a conflict');
  const draft = { ...pull(4, 'pass'), headRefName: 'office/w4', isDraft: true, mergeable: 'CONFLICTING' } as GhPull;
  assert.deepEqual(blockersOf(w, undefined, NOW, undefined, [draft]), []);
  assert.deepEqual(blockersOf(w, undefined, NOW, undefined, [{ ...conflictingPull(4), state: 'MERGED' }]), [], 'a merged PR cannot conflict');
  assert.deepEqual(blockersOf(w, undefined, NOW, undefined, []), [], 'with no pulls to judge, nothing is claimed');
});

test('the conflict blocker outranks a failed task and a stalled worker but not a question', () => {
  const w = prWorker('mochi', 4);
  const failed = task('t1', { status: 'done', outcome: 'failed', error: 'boom', finishedAt: NOW });
  assert.deepEqual(blockersOf(w, failed, NOW, undefined, [conflictingPull(4)]).map((b) => b.kind), ['conflicting', 'failed']);
  assert.deepEqual(blockersOf(prWorker('mochi', 4), task('t1'), NOW, undefined, [conflictingPull(4)]).map((b) => b.kind), ['conflicting']);
});

test('the manager hash changes when a conflict appears and when it clears, so it is nudged once each way', () => {
  const empty = managerReport({ workers: [], rows: [], tasks: [], pulls: [], floor: { id: 'f1', name: 'Floor one', branch: 'main' }, maxWorkers: 2, freeDesk: 'desk-1', now: NOW });
  const clean = report([prWorker('mochi', 4)], [], [{ ...pull(4, 'pass'), headRefName: 'office/w4', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' } as GhPull]);
  const dirty = report([prWorker('mochi', 4)], [], [conflictingPull(4)]);
  assert.equal(managerHash(clean), managerHash(empty), 'a clean floor is not a new thing to be told');
  assert.notEqual(managerHash(dirty), managerHash(clean), 'a conflict appearing is a change');
  assert.equal(shouldNudge(managerHash(clean), managerHash(dirty), true), true);
  assert.equal(shouldNudge(managerHash(dirty), managerHash(dirty), true), false, 'and it is not said twice');
  assert.equal(shouldNudge(managerHash(dirty), managerHash(clean), true), true, 'the conflict clearing is a change too');
});

test('two workers whose open pull requests change the same file each see the other and the files', () => {
  const mochi = prWorker('mochi', 4, ['src/a.ts', 'docs/x.md']);
  const byte = prWorker('byte', 5, ['src/a.ts']);
  const r = report([mochi, byte], [], [pull(4, 'pass'), pull(5, 'pass')]);
  assert.deepEqual(r.workers[0].overlaps, [{ worker: { id: 'byte', name: 'byte' }, pr: 5, files: ['src/a.ts'] }]);
  assert.deepEqual(r.workers[1].overlaps, [{ worker: { id: 'mochi', name: 'mochi' }, pr: 4, files: ['src/a.ts'] }]);
});

test('workers on different files overlap nothing, and a conflicting one names the other PR in its why', () => {
  const apart = report([prWorker('mochi', 4, ['src/a.ts']), prWorker('byte', 5, ['src/b.ts'])], [], [pull(4, 'pass'), pull(5, 'pass')]);
  assert.deepEqual(apart.workers.map((w) => w.overlaps), [undefined, undefined]);
  const fight = report([prWorker('mochi', 4, ['src/a.ts']), prWorker('byte', 5, ['src/a.ts'])], [], [conflictingPull(4), pull(5, 'pass')]);
  const why = fight.workers[0].blockers.find((b) => b.kind === 'conflicting')!.why;
  assert.match(why, /PR #5 from byte \(src\/a\.ts\)/, 'the why says who else is landing there, so a person can tell whether to rebase or wait');
  const other = fight.workers[1];
  assert.deepEqual(other.overlaps?.map((o) => o.pr), [4]);
});

test('overlap needs an open pull request and a filed checklist; without either there is no signal', () => {
  // A worker whose PR merged is out of the collision picture, whatever files it reported.
  const merged = prWorker('mochi', 4, ['src/a.ts']);
  const r = report([merged, prWorker('byte', 5, ['src/a.ts'])], [], [{ ...pull(4, 'pass'), headRefName: 'office/w4', state: 'MERGED' }, pull(5, 'pass')]);
  assert.deepEqual(r.workers[1].overlaps, undefined);
  // A worker with no checklist reports no files, so it contributes nothing to another's overlap.
  const noFiles = report([prWorker('mochi', 4), prWorker('byte', 5, ['src/a.ts'])], [], [pull(4, 'pass'), pull(5, 'pass')]);
  assert.deepEqual(noFiles.workers[1].overlaps, undefined);
});

test('a worker overlapping more workers than the list names is told how many it left out', () => {
  const many = Array.from({ length: OVERLAP_WORKERS_MAX + 2 }, (_, i) => prWorker(`w${i}`, 20 + i, ['src/a.ts']));
  const r = report([prWorker('mochi', 11, ['src/a.ts']), ...many], [], [pull(11, 'pass'), ...Array.from({ length: OVERLAP_WORKERS_MAX + 2 }, (_, i) => pull(20 + i, 'pass'))]);
  assert.equal(r.workers[0].overlaps?.length, OVERLAP_WORKERS_MAX);
  assert.equal(r.workers[0].moreOverlaps, 2, 'the report says how many are not named, rather than reading as the lot');
  assert.equal(r.workers[1].moreOverlaps, 2, 'a worker in the crowd overlaps mochi and the other six, and leaves out two of them');
  // Exactly the cap and no more: nothing left out, so nothing claimed.
  const exact = Array.from({ length: OVERLAP_WORKERS_MAX }, (_, i) => prWorker(`w${i}`, 20 + i, ['src/a.ts']));
  const fits = report([prWorker('mochi', 11, ['src/a.ts']), ...exact], [], [pull(11, 'pass'), ...Array.from({ length: OVERLAP_WORKERS_MAX }, (_, i) => pull(20 + i, 'pass'))]);
  assert.equal(fits.workers[0].overlaps?.length, OVERLAP_WORKERS_MAX);
  assert.equal(fits.workers[0].moreOverlaps, undefined);
});
