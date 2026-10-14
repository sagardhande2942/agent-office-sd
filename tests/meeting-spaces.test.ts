import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MeetingSpaces } from '../src/server/meeting-spaces/service.js';
import { meetingSeatOccupied } from '../src/server/meeting-spaces/seats.js';
import type { MeetingWorkers, MeetingTrees } from '../src/server/meetings.js';
import type { MeetingRequest, WorkerInfo } from '../src/shared/protocol.js';
import { MEETING_SEATS } from '../src/shared/layout.js';
import { meetingSpaceState, participantMeeting, spaceStatus } from '../src/shared/meeting-spaces.js';
import { restoreWorkers } from '../src/server/workers/persist.js';
import type { Worker } from '../src/server/workers/types.js';
import { Store } from '../src/client/state/store.js';
import { meeting } from '../src/client/state/slices/meeting.js';
import { meetingSpaces } from '../src/client/state/slices/meeting-spaces.js';
import { selectMeetingSpace } from '../src/client/shared/meeting-spaces/state.js';
import { workerVisible } from '../src/client/state/worker-visibility.js';

function fixture(t: { after(fn: () => void): void }, git = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'meeting-spaces-'));
  const data = path.join(dir, '.agent-office'); mkdirSync(data);
  const workers: WorkerInfo[] = [], typed: string[] = [], killed: string[] = [];
  let seq = 0, room: MeetingSpaces;
  const manager: MeetingWorkers = {
    defaultProvider: 'claude', list: () => workers,
    seat(deskId, by, prompt, provider, model, effort, m) {
      if (meetingSeatOccupied(workers.map(info => ({ info })), deskId, m.id)) return 'taken';
      const w: WorkerInfo = { id: `w${++seq}`, deskId, kind: 'agent', name: `Worker ${seq}`, provider, model, effort, prompt,
        meeting: m.id, worktree: m.worktree, color: '#fff', status: 'starting', acked: true, createdBy: by, createdAt: Date.now(), cols: 80, rows: 24, viewers: [] };
      workers.push(w); return w;
    },
    prompt() { return undefined; }, write(id) { typed.push(id); },
    async kill(id) { killed.push(id); const i = workers.findIndex(w => w.id === id); if (i >= 0) workers.splice(i, 1); room.onWorkerGone(id); return {}; },
  };
  const trees: MeetingTrees = {
    create(slug) { const p = `trees/${slug}`; mkdirSync(path.join(dir, p), { recursive: true }); return { path: p, branch: slug, base: 'main' }; },
    async inspect() { return { dirty: false } as never; }, async remove() { return undefined; },
  };
  const make = () => new MeetingSpaces(dir, data, manager, git ? trees : undefined, { update() {}, toast() {}, hiringPaused: () => undefined, postReview: async () => 'review' });
  room = make(); t.after(() => { room.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const start = (spaceId = 'main', extra: Partial<MeetingRequest> = {}) => room.start({ spaceId, pattern: 'debate', prompt: 'Choose a cache', roles: ['Chair', 'Skeptic'], rounds: 2, ...extra }, 'Ada');
  return { dir, data, workers, typed, killed, start, get room() { return room; }, restart() { room.shutdown(); room = make(); } };
}

test('independent spaces run concurrently on the same chairs with isolated worktrees and scoped controls', t => {
  const f = fixture(t);
  assert.equal(f.room.create('Product planning'), undefined);
  const id = f.room.state().spaces![1].id;
  assert.equal(f.start(), undefined); assert.equal(f.start(id), undefined);
  const [a, b] = f.room.state().spaces!.map(s => s.current!);
  assert.notEqual(a.worktree?.path, b.worktree?.path);
  assert.deepEqual(a.seats.map(s => s.deskId), b.seats.map(s => s.deskId));
  assert.equal(f.workers.length, 4);
  assert.match(f.start(id)!, /busy/);
  for (const seat of a.seats) {
    const worker = f.workers.find(w => w.id === seat.workerId)!;
    const turn = a.turns.find(t => t.seat === a.seats.indexOf(seat))!;
    worker.status = 'working'; f.room.onWorker(worker);
    const file = path.join(f.dir, a.worktree!.path, turn.file); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, '# Proposal');
    worker.status = 'done'; f.room.onWorker(worker);
  }
  assert.equal(f.room.state().current!.round, 2);
  assert.equal(f.room.state().spaces![1].current!.round, 1);
  for (const worker of f.workers.filter(w => w.meeting === b.id)) worker.status = 'working';
  assert.equal(f.room.stop('Ada', id), undefined);
  assert.deepEqual(new Set(f.typed), new Set(b.seats.map(s => s.workerId)));
  assert.equal(f.room.state().current!.status, 'running');
  assert.equal(f.room.clear('Ada', id), undefined);
  assert.equal(f.room.state().spaces![1].current, null);
  assert.equal(f.room.state().spaces![1].past[0].id, b.id);
  assert.deepEqual(new Set(f.killed), new Set(b.seats.map(s => s.workerId)));
  assert.equal(f.workers.length, 2);
});

test('space catalogue, separate histories and legacy main meeting survive restart', t => {
  const f = fixture(t); assert.equal(f.start(), undefined);
  const original = f.room.state().current!.id;
  assert.equal(f.room.create('Bug investigation'), undefined);
  const id = f.room.state().spaces![1].id;
  assert.equal(f.start(id), undefined);
  assert.equal(f.room.rename(id, 'Release review'), undefined);
  const before = f.room.state(); f.restart();
  assert.equal(f.room.state().current!.id, original);
  assert.deepEqual(JSON.parse(JSON.stringify(f.room.state())), JSON.parse(JSON.stringify(before)));
  assert.equal(f.room.stop('Ada', id), undefined);
  assert.equal(f.room.state().current!.status, 'running');
  assert.ok(readFileSync(path.join(f.data, 'meetings.json'), 'utf8').includes(original));
});

test('validation bounds spaces, rejects duplicate names and unknown destinations, and avoids parallel non-Git writes', t => {
  const f = fixture(t, false);
  for (const name of ['', ' ', '../', 'a'.repeat(61), '\0bad']) {
    if (name === '../') continue; // Names are labels, never file paths.
    assert.match(f.room.create(name)!, /name/);
  }
  assert.equal(f.room.create('Investigate'), undefined);
  assert.match(f.room.create(' investigate ')!, /already/);
  assert.match(f.room.rename('missing', 'Name')!, /No such/);
  assert.match(f.start('missing')!, /No such/);
  assert.equal(f.start(), undefined);
  assert.match(f.start(f.room.state().spaces![1].id)!, /Git project/);
  for (let i = 2; i < 16; i++) assert.equal(f.room.create(`Space ${i}`), undefined);
  assert.match(f.room.create('Overflow')!, /16/);
});

test('restart retains workers from different meetings at one physical chair but rejects duplicates within one meeting', t => {
  const f = fixture(t); const deskId = MEETING_SEATS[0].id;
  const file = path.join(f.data, 'workers.json');
  writeFileSync(file, JSON.stringify([
    { id: 'one', deskId, meeting: 'meeting-a' }, { id: 'two', deskId, meeting: 'meeting-b' },
    { id: 'duplicate', deskId, meeting: 'meeting-a' }, { id: 'outsider', deskId },
  ]));
  const restored = new Map<string, Worker>();
  restoreWorkers(file, restored, 'claude', (desk, id) => meetingSeatOccupied(restored.values(), desk, id));
  assert.deepEqual([...restored.keys()], ['one', 'two']);
});

test('viewer selection stays local across server updates and only projects its agents into the shared room', t => {
  const f = fixture(t); f.room.create('Other'); const id = f.room.state().spaces![1].id;
  f.start(); f.start(id);
  const a = new Store([meeting, meetingSpaces]), b = new Store([meeting, meetingSpaces]);
  a.workers = new Map(f.workers.map(w => [w.id, w])); b.workers = a.workers;
  const msg = { t: 'meeting' as const, state: f.room.state() }; a.apply(msg); b.apply(msg);
  selectMeetingSpace(a, id);
  assert.equal(a.meeting.current!.id, msg.state.spaces![1].current!.id);
  assert.equal(b.meeting.current!.id, msg.state.current!.id);
  a.apply({ t: 'meeting', state: f.room.state() });
  assert.equal(a.selectedMeetingSpace, id);
  assert.equal([...a.workers.values()].filter(w => workerVisible(w, a)).length, 2);
  assert.equal(a.workerAtDesk(MEETING_SEATS[0].id)!.meeting, a.meeting.current!.id);
  assert.equal(b.workerAtDesk(MEETING_SEATS[0].id)!.meeting, b.meeting.current!.id);
  assert.equal(meetingSpaceState(f.room.state(), id).current!.id, a.meeting.current!.id);
  const participant = f.workers.find(w => w.meeting === a.meeting.current!.id)!;
  assert.equal(participantMeeting(f.room.state(), participant.id)!.id, a.meeting.current!.id);
  const other = f.workers.find(w => w.meeting === b.meeting.current!.id)!;
  assert.equal(participantMeeting(f.room.state(), participant.id, other.id)!.id, a.meeting.current!.id);
  participant.status = 'needs_input';
  assert.equal(spaceStatus(msg.state.spaces![1], f.workers), 'Needs attention');
  assert.equal(spaceStatus(msg.state.spaces![0], f.workers), 'Working');
});
