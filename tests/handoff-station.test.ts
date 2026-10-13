import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { WorkerMessage } from '../src/shared/communications.js';
import type { HandoffPacket } from '../src/shared/handoff.js';
import { fetchHandoffs, parseHandoffs, type HandoffResponse } from '../src/client/shared/handoff/api.js';
import {
  HANDOFF_ACCEPTANCE_NOTE,
  checksSummary,
  contextLine,
  filesLine,
  packetActors,
  packetHeadline,
  questionsLine,
  receiptLine,
  stateLabel,
  taskLabel,
} from '../src/client/shared/handoff/format.js';

// The Handoff station's client modules: what its window says about a packet, how it reads the station's
// API (and how it fails), and that the office and Lite both reach it without Lite loading the 3D office.

const client = (path: string) => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8');

const receipt: WorkerMessage = {
  id: 'msg-1', threadId: 'thread-1', kind: 'request',
  from: { id: 'w-ada', name: 'Ada' }, to: { id: 'w-grace', name: 'Grace' },
  text: 'Continue the handoff packet', context: { branch: 'feat/handoff', commit: 'abc1234' },
  at: 1_700_000_000_000, expiresAt: 1_700_100_000_000,
  status: 'delivered', deliveredAt: 1_700_000_100_000,
};

const packet: HandoffPacket = {
  id: 'ho-1', floorId: 'floor-1', key: 'continue-packets-1',
  source: { id: 'w-ada', name: 'Ada' }, recipient: { id: 'w-grace', name: 'Grace' },
  task: { id: 'w-ada:3', revision: 3, goal: 'Finish the handoff station' },
  completedWork: 'The durable store and the API are in.', nextSteps: 'Build the station window and run the full checks.',
  files: ['src/client/shared/handoff/ui.ts'],
  checks: [
    { name: 'unit tests', status: 'passed', evidence: 'node --test tests/handoff.test.ts: 4 passed' },
    { name: 'build', status: 'skipped', evidence: 'the station window was still unfinished' },
  ],
  questions: ['Who owns the follow-up PR?'],
  context: { branch: 'feat/handoff', commit: 'abc1234', pr: 'https://github.com/sagardhande2942/agent-office-sd/pull/9', worktree: '/tmp/worktrees/handoff' },
  evidence: 'worker-reported', state: 'offered', offeredAt: 1_700_000_000_000, messageId: 'msg-1', receipt,
};

test('a packet reads as its state, task, context and receipt, never as an independent verdict', () => {
  assert.equal(stateLabel('offered'), 'Offered');
  assert.equal(stateLabel('accepted'), 'Accepted');
  assert.equal(stateLabel('cancelled'), 'Cancelled');
  assert.equal(taskLabel(packet), 'w-ada:3 @ revision 3');
  assert.equal(packetHeadline(packet), 'Ada → Grace: Finish the handoff station');
  const context = contextLine(packet.context);
  for (const part of ['feat/handoff', 'abc1234', 'https://github.com/sagardhande2942/agent-office-sd/pull/9', '/tmp/worktrees/handoff']) assert.ok(context.includes(part), `${part} is missing from ${context}`);
  assert.match(contextLine({}), /No branch, commit, pull request or worktree/);
  assert.match(receiptLine(packet.receipt), /request · delivered · Ada → Grace/);
  assert.match(receiptLine(packet.receipt), /feat\/handoff/);
  assert.match(receiptLine(), /No tracked inbox receipt/);
});

test('checks, files and questions say what was recorded, including an explicit none', () => {
  assert.equal(checksSummary(packet.checks), '2 recorded · 1 passed · 0 failed · 1 skipped');
  assert.equal(checksSummary([]), 'No checks were recorded.');
  assert.equal(filesLine(['a.ts', 'b.ts']), 'a.ts, b.ts');
  assert.equal(filesLine([], 'No files changed: this packet only records a handover.'), 'No files changed: this packet only records a handover.');
  assert.match(filesLine([]), /No changed files were recorded/);
  assert.equal(questionsLine(['One', 'Two']), '2 unresolved questions');
  assert.equal(questionsLine([], 'None; the API contract is agreed.'), 'None; the API contract is agreed.');
  assert.match(questionsLine([]), /None recorded/);
});

test('the window says acceptance is the recipient worker’s, and that it moves nothing', () => {
  assert.match(HANDOFF_ACCEPTANCE_NOTE, /recipient worker/);
  assert.match(HANDOFF_ACCEPTANCE_NOTE, /nothing in this window accepts one/i);
  assert.match(HANDOFF_ACCEPTANCE_NOTE, /does not move files/);
  assert.match(HANDOFF_ACCEPTANCE_NOTE, /worktree/);
  assert.match(HANDOFF_ACCEPTANCE_NOTE, /replace or complete the source task/);
  assert.match(HANDOFF_ACCEPTANCE_NOTE, /does not replace the recipient's own current task/);
});

test('a packet names its source, recipient and continuation owner once each', () => {
  const actors = packetActors({ ...packet, state: 'accepted', continuationOwner: { id: 'w-grace', name: 'Grace' } });
  assert.deepEqual(actors.map((a) => a.id), ['w-ada', 'w-grace']);
  assert.deepEqual(packetActors(packet).map((a) => a.name), ['Ada', 'Grace']);
});

test('the station body reads as its packets, and anything else is an error rather than an empty floor', () => {
  assert.deepEqual(parseHandoffs({ handoffs: [packet] }), [packet]);
  assert.deepEqual(parseHandoffs({ handoffs: [] }), []);
  for (const body of [null, undefined, {}, { handoffs: 'none' }, { handoffs: {} }, 'ok']) {
    assert.throws(() => parseHandoffs(body), /unexpected response/, `accepted ${JSON.stringify(body)}`);
  }
});

test('fetching a floor asks for it by name and surfaces what the office said', async () => {
  const asked: string[] = [];
  const respond = (body: unknown, ok = true, status = 200) => async (url: string): Promise<HandoffResponse> => {
    asked.push(url);
    return { ok, status, json: async () => body };
  };
  assert.deepEqual(await fetchHandoffs('floor one', respond({ handoffs: [packet] })), [packet]);
  assert.equal(asked[0], '/api/handoffs?floor=floor%20one');
  await assert.rejects(() => fetchHandoffs('f', respond({ error: 'Unknown floor' }, false, 404)), /Unknown floor/);
  await assert.rejects(() => fetchHandoffs('f', respond(null, false, 503)), /HTTP 503/);
  await assert.rejects(() => fetchHandoffs('f', respond({ nope: true })), /unexpected response/);
});

test('the office installs the station once, as its own feature with its own fixture', () => {
  const main = client('main.ts');
  assert.equal(main.split('installHandoff(ctx').length - 1, 1, 'main.ts installs the handoff station once');
  const index = client('features/handoff/index.ts');
  assert.match(index, /export function installHandoff\(ctx: Ctx, parts: Pick<Parts, 'waiting'>\)/);
  assert.match(index, /interactions\.define\('handoffstation'/);
  assert.match(index, /HUD_ACTIONS\.push/);
  const build = client('world/office/build.ts');
  assert.match(build, /import \{ handoffStation \} from '\.\.\/\.\.\/features\/handoff\/world'/);
  assert.match(build, /^\s*handoffStation,$/m);
  assert.match(client('features/handoff/world.ts'), /kind: 'handoffstation'/);
});

test('Lite opens the station through the shared module alone, which loads no three.js', () => {
  const lite = client('lite.ts');
  assert.match(lite, /import \{ openHandoffStation \} from '\.\/shared\/handoff\/ui'/);
  assert.match(lite, /openHandoffStation\(openWorker\)/);
  assert.doesNotMatch(lite, /features\/handoff/, 'Lite does not load the 3D feature');
  assert.match(client('lite.html'), /id="btn-handoffs"/);
  for (const file of ['api.ts', 'format.ts', 'ui.ts', 'ui.css']) {
    const source = client(`shared/handoff/${file}`);
    assert.doesNotMatch(source, /from 'three(\/|')/, `${file} imports three.js`);
    assert.doesNotMatch(source, /from '\.\.\/\.\.\/(core|features|input|world|player)\//, `${file} loads part of the 3D office`);
  }
});

test('the station window is read-only, brings its own ✕, and goes through openModal for Esc and mouse-look', () => {
  const ui = client('shared/handoff/ui.ts');
  assert.doesNotMatch(ui, /net\.send/, 'the station never sends anything: accepting is a worker’s action');
  assert.match(ui, /h\('button\.btn\.close'/);
  assert.match(ui, /openModal\(el, \{ reading: true, doing: 'reading a task handoff'/);
  assert.match(ui, /fetchHandoffs\(/);
  assert.match(ui, /Could not read the handoff station/);
});
