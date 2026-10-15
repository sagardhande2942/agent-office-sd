import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteMeetings } from '../src/server/meeting-spaces/remote.js';
import { meetingHostCalls } from '../src/server/meeting-spaces/host.js';
import type { Floor } from '../src/server/floor.js';
import type { MeetingState } from '../src/shared/protocol.js';

test('remote meeting commands preserve space IDs, capacity and host refusals, and guard older hosts', async () => {
  const sent: { t: string; body: Record<string, unknown> }[] = [];
  let supported = false;
  const state: MeetingState = { current: null, past: [], spaces: [] };
  let reply: unknown;
  const remote = new RemoteMeetings(async (t, body) => { sent.push({ t, body }); return reply; }, () => supported, () => state);
  assert.match((await remote.create('Planning'))!, /Update the floor host/);
  assert.equal(sent.length, 0);
  supported = true;
  assert.equal(await remote.create('Planning'), undefined);
  await remote.rename('other', 'Release');
  const req = { spaceId: 'other', pattern: 'debate' as const, prompt: 'Choose a cache' };
  await remote.start(req, 'Ada', 'account', { room: 3 });
  await remote.stop('Ada', 'other');
  await remote.clear('Ada', 'other');
  await remote.finishAnyway('meeting-id', 'Ada');
  assert.deepEqual(sent.map(s => s.t), ['meeting-space.create', 'meeting-space.rename', 'meeting.start', 'meeting.stop', 'meeting.clear', 'meeting.finish']);
  assert.deepEqual(sent[2].body, { req, by: 'Ada', owner: 'account', capacity: { room: 3 } });
  assert.deepEqual(sent[3].body, { by: 'Ada', spaceId: 'other' });
  assert.deepEqual(sent[4].body, { by: 'Ada', spaceId: 'other' });
  assert.equal(remote.state(), state);
  reply = 'Laptop is asleep';
  assert.equal(await remote.create('Failed'), reply);
  supported = false;
  assert.match((await remote.stop('Ada', 'other'))!, /Update the floor host/);
});

test('host meetings validate providers and enforce office and host capacity after fetching', async () => {
  let fetched = 0, started = 0, count = 0;
  const floor = {
    id: 'hosted', project: { agentProviders: ['claude'] },
    workers: { officeDefault: { provider: 'claude' }, list: () => Array(count).fill({}), fetchBase: async () => { fetched++; } },
    meetings: { start: () => { started++; } },
  } as unknown as Floor;
  const floors = new Map([[floor.id, floor]]), calls = meetingHostCalls(floors, 4);
  const req = { pattern: 'debate', prompt: 'Compare caches', roles: ['Chair', 'Skeptic'] };
  const call = (extra: Record<string, unknown> = {}) => calls['meeting.start'](floor, { req, by: 'Ada', capacity: { room: 2 }, ...extra });
  assert.match(String(await call({ capacity: undefined })), /capacity/);
  assert.match(String(await call({ capacity: { room: 1 } })), /worker limit/);
  assert.match(String(await call({ capacity: { room: 2, paused: 'Budget exhausted' } })), /Budget exhausted/);
  assert.match(String(await call({ req: { ...req, provider: 'missing' } })), /provider installed/);
  assert.match(String(await call({ req: { ...req, roles: 'bad' } })), /roles/);
  assert.match(String(await call({ req: { ...req, roles: Array(20).fill('Role') } })), /worker count/);
  assert.equal(started, 0); assert.equal(fetched, 0);
  count = 3;
  assert.match(String(await call()), /seat limit/);
  count = 0;
  assert.equal(await call(), undefined); assert.equal(started, 1); assert.equal(fetched, 1);
  floor.workers.fetchBase = async () => { count = 4; };
  assert.match(String(await call()), /seat limit/);
  assert.equal(started, 1, 'capacity is checked again after the asynchronous fetch');
  count = 0; floor.workers.fetchBase = async () => { floors.delete(floor.id); };
  assert.match(String(await call()), /floor closed/);
});

test('remote starts reserve office capacity without asking for office account sign-ins', async () => {
  const { startMeeting } = await import('../src/server/meeting-spaces/office.js');
  const warnings: (string | undefined)[] = [], calls: unknown[][] = [];
  let complete!: (value: string | undefined) => void;
  const pending = new Promise<string | undefined>(resolve => { complete = resolve; });
  const floor = { id: 'remote' };
  const remote = { meetings: { start: (...args: unknown[]) => { calls.push(args); return pending; } } };
  const ctx = {
    remoteFloors: new Map([['remote', remote]]), machine: { room: () => 3 }, ledger: {},
    warn: (_c: unknown, error: string | undefined) => warnings.push(error),
    withSignIn: () => assert.fail('remote agents use host sign-ins'),
    withFreshBase: () => assert.fail('remote base fetch belongs on the host'),
  };
  const client = { accountId: 'viewer' }, request = { pattern: 'debate' as const, prompt: 'Choose a cache', roles: ['Chair', 'Skeptic'] };
  type Context = Parameters<typeof startMeeting>[0];
  type Client = Parameters<typeof startMeeting>[1];
  type Actions = Parameters<typeof startMeeting>[2];
  const start = () => startMeeting(ctx as unknown as Context, client as unknown as Client, floor as Actions, request, 'Ada');
  start(); start();
  assert.equal(calls.length, 1);
  assert.match(warnings.at(-1)!, /room for 2/);
  assert.deepEqual(calls[0], [request, 'Ada', 'viewer', { room: 3 }]);
  complete(undefined); await pending; await new Promise(resolve => setImmediate(resolve));
  start(); assert.equal(calls.length, 2, 'reservation is released after the host replies');
  await new Promise(resolve => setImmediate(resolve));
});
