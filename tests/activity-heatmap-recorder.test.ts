import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActivityHeatmapRecorder } from '../src/server/activity-heatmap/recorder.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { TeamRun } from '../src/shared/master-workers.js';

function setup(t: TestContext, options: { maxIntervals?: number; maxAgeMs?: number } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-recorder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let time = 1000;
  const file = path.join(dir, 'heatmap.json');
  const create = () => new ActivityHeatmapRecorder({ file, now: () => time, ...options });
  return { dir, file, create, recorder: create(), at: (next: number) => { time = next; } };
}
const worker = (status: WorkerInfo['status'] = 'working', id = 'w') => ({ id, status, kind: 'agent', action: 'test', prompt: 'secret' }) as WorkerInfo;
function run(attempt = 1): TeamRun {
  return { id: 'activity', phase: 'running', tasks: [{ id: 'task', status: 'running', attempts: Array.from({ length: attempt }, (_, i) => ({ workerId: i === attempt - 1 ? 'w' : 'previous', status: i === attempt - 1 ? 'running' : 'rejected' })) }] } as TeamRun;
}

test('waiting/resume, explicit implementation/check boundaries and duplicate observations', t => {
  const { recorder: r, at, file, dir } = setup(t);
  r.update(worker());
  at(1100); r.update(worker());
  assert.equal(r.snapshot().intervals.length, 1);
  r.signal('w', 'implementation');
  at(1200); r.signal('w', 'checks');
  at(1300); r.update(worker('needs_input'));
  at(1400); r.update(worker());
  at(1500); r.signal('w', 'checks');
  at(1600); r.signal('w', null);
  at(1700); r.remove(worker());
  assert.deepEqual(r.snapshot().intervals.map(i => [i.phase, i.start, i.end]), [
    ['unknown', 1000, 1100], ['implementation', 1100, 1200], ['checks', 1200, 1300], ['waiting', 1300, 1400], ['unknown', 1400, 1500], ['checks', 1500, 1600], ['unknown', 1600, 1700],
  ]);
  assert.equal(readFileSync(file, 'utf8').includes('secret'), false);
  assert.deepEqual(readdirSync(dir), ['heatmap.json']);
});

test('retry work is an interval; checks and waits take precedence; review ends on acceptance and pause closes work', t => {
  const { recorder: r, at } = setup(t);
  const team = run(2);
  r.team(team); r.update(worker());
  at(1100); r.signal('w', 'checks');
  at(1200); r.update(worker('needs_input'));
  at(1300); r.update(worker());
  at(1400); team.tasks[0].status = 'review'; team.tasks[0].attempts[1].status = 'submitted'; r.team(team);
  at(1500); r.team(team);
  assert.equal(r.snapshot().intervals.at(-1)?.start, 1400);
  at(1600); team.tasks[0].status = 'done'; team.tasks[0].attempts[1].status = 'accepted'; r.team(team);
  assert.equal(r.snapshot().intervals.at(-1)?.end, 1600);
  assert.deepEqual(r.snapshot().intervals.filter(i => i.end !== i.start).map(i => i.phase), ['retries', 'checks', 'waiting', 'retries', 'review']);
  at(1700); const next = run(); r.team(next);
  at(1800); next.phase = 'paused'; r.team(next);
  assert.equal(r.snapshot().intervals.at(-1)?.end, 1800);
  at(1900); next.phase = 'running'; r.team(next);
  assert.equal(r.snapshot().intervals.at(-1)?.start, 1900);
});

test('restart closes at heartbeat, exposes downtime and requires fresh observation', t => {
  const s = setup(t);
  s.recorder.update(worker());
  s.at(1500); s.recorder.checkpoint();
  s.at(3000); const recovered = s.create();
  assert.deepEqual(recovered.snapshot().intervals, [{ workerId: 'w', phase: 'unknown', start: 1000, end: 1500 }]);
  assert.deepEqual(recovered.snapshot().coverage.gaps, [{ start: 1500, end: 3000 }]);
  s.at(3100); recovered.update(worker('offline'));
  assert.equal(recovered.snapshot().intervals.length, 1);
  s.at(3200); recovered.update(worker());
  assert.equal(recovered.snapshot().intervals.at(-1)?.start, 3200);
});

test('removal does not resurrect pending review and multiple workers never overlap themselves', t => {
  const { recorder: r, at } = setup(t);
  const team = run(); team.tasks[0].status = 'review'; team.tasks[0].attempts[0].status = 'submitted';
  r.update(worker()); r.update(worker('working', 'other'));
  at(1100); r.team(team);
  at(1200); r.remove(worker());
  at(1300); r.team(team);
  assert.equal(r.snapshot().intervals.filter(i => i.end === undefined).length, 1);
  const own = r.snapshot().intervals.filter(i => i.workerId === 'w');
  assert.ok(own.every((i, n) => !n || own[n - 1].end! <= i.start));
});

test('count and age retention, malformed and legacy files remain explicitly partial', t => {
  const s = setup(t, { maxIntervals: 2, maxAgeMs: 500 });
  s.recorder.update(worker());
  s.at(1100); s.recorder.signal('w', 'checks');
  s.at(1200); s.recorder.signal('w', null);
  assert.equal(s.recorder.snapshot().intervals.length, 2);
  assert.equal(s.recorder.snapshot().coverage.dropped, 1);
  s.at(2000); s.recorder.checkpoint();
  assert.equal(s.recorder.snapshot().intervals.length, 1);
  assert.equal(s.recorder.snapshot().intervals[0].start, 1500);
  writeFileSync(s.file, JSON.stringify({ replay: { events: [] } }));
  assert.equal(s.create().snapshot().coverage.historical, true);
  writeFileSync(s.file, '{');
  assert.equal(s.create().snapshot().intervals.length, 0);
});

test('pause and stop close master work as well as attempts, and clock rollback never overlaps', t => {
  const { recorder: r, at } = setup(t);
  const team = run(); team.masterId = 'master';
  r.team(team); r.update(worker('working', 'master')); r.update(worker());
  at(1200); r.checkpoint();
  at(1100); r.signal('master', 'checks');
  assert.equal(r.snapshot().intervals.at(-1)?.start, 1200);
  at(1300); team.phase = 'paused'; r.team(team);
  assert.equal(r.snapshot().intervals.filter(i => i.end === undefined).length, 0);
  at(1400); team.phase = 'running'; r.team(team);
  assert.equal(r.snapshot().intervals.filter(i => i.end === undefined).length, 2);
  at(1500); team.phase = 'stopped'; r.team(team);
  assert.equal(r.snapshot().intervals.filter(i => i.end === undefined).length, 0);
});

test('suspension closes observed work and non-team sessions retain structured revision identity', t => {
  const { recorder: r, at } = setup(t);
  const w = { ...worker(), sessionId: 'session-1', completionRevision: 7 };
  r.update(w);
  at(1100); r.update({ ...w, suspended: true });
  assert.equal(r.snapshot().intervals.at(-1)?.end, 1100);
  assert.equal(r.snapshot().intervals.at(-1)?.taskId, 'revision-7');
  assert.equal(r.snapshot().intervals.at(-1)?.activityId, 'session-1');
  at(1200); r.update(w);
  assert.equal(r.snapshot().intervals.at(-1)?.start, 1200);
});

test('restart cannot resurrect review for a removed worker from retained team state', t => {
  const s = setup(t), team = run();
  team.tasks[0].status = 'review'; team.tasks[0].attempts[0].status = 'submitted';
  s.recorder.update(worker()); s.recorder.team(team);
  s.at(1100); s.recorder.remove(worker());
  s.at(2000); const recovered = s.create(); recovered.team(team);
  assert.equal(recovered.snapshot().intervals.filter(i => i.end === undefined).length, 0);
});
