import test from 'node:test';
import assert from 'node:assert/strict';
import { STALL_MS, blockersOf, managerHash, managerReport, shouldNudge, taskBlocker, verdictOf } from '../src/shared/manager.js';
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