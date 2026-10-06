import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Communications, messageContext } from '../src/server/communications.js';
import { renderDashboard, type Dashboard } from '../src/server/tui-dashboard.js';
import type { FloorView } from '../src/shared/protocol.js';

const ada = { id: 'ada', name: 'Ada' }, grace = { id: 'grace', name: 'Grace' }, stranger = { id: 'other', name: 'Other' };
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-messages-'));
  let now = 1000, changes = 0;
  const create = () => new Communications(dir, () => changes++, () => now);
  return { dir, ledger: create(), reload: create, advance: (ms: number) => now += ms, changes: () => changes, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('request, delivery, acceptance, contextual reply and requester acknowledgment survive restart', () => {
  const f = fixture();
  try {
    const request = f.ledger.request(grace, ada, { prompt: 'What fields will /users return?', key: 'users' });
    assert.equal(request.status, 'pending');
    assert.deepEqual(f.ledger.inbox(stranger).messages, []);
    assert.equal(f.ledger.get(request.id)?.status, 'pending', 'observation by others does not deliver');
    assert.equal(f.ledger.inbox(ada).messages[0].status, 'delivered');
    assert.equal(f.reload().get(request.id)?.status, 'delivered');
    f.ledger.acknowledge(ada, request.id);
    assert.equal(f.ledger.get(request.id)?.status, 'acknowledged');
    const context = { branch: 'api/users', commit: 'abcdef123', files: ['src/users.ts'] };
    const reply = f.ledger.reply(ada, request.id, { prompt: '{ id, name, email }', context, key: 'reply-users' });
    assert.equal(reply.threadId, request.id);
    assert.equal(reply.replyTo, request.id);
    assert.deepEqual(reply.context, context);
    assert.equal(f.ledger.get(request.id)?.status, 'answered');
    f.ledger.inbox(grace);
    assert.equal(f.ledger.get(reply.id)?.status, 'delivered');
    f.ledger.acknowledge(grace, reply.id);
    assert.equal(f.reload().get(request.id)?.status, 'completed');
    const changes = f.changes();
    f.ledger.acknowledge(grace, reply.id);
    assert.equal(f.changes(), changes, 'repeated acknowledgment is idempotent');
    if (process.platform !== 'win32') assert.equal(statSync(path.join(f.dir, 'communications.json')).mode & 0o777, 0o600);
    assert.equal(f.ledger.request(grace, ada, { prompt: request.text, key: 'users' }).id, request.id);
    assert.equal(f.ledger.reply(ada, request.id, { prompt: reply.text, context, key: 'reply-users' }).id, reply.id, 'retry after completion returns original receipt');
    assert.throws(() => f.ledger.reply(ada, request.id, { prompt: 'New reply' }), /completed/);
  } finally { f.close(); }
});

test('recipient identity and request relationships cannot be forged', () => {
  const f = fixture();
  try {
    const m = f.ledger.request(grace, ada, { prompt: 'Review this' });
    assert.throws(() => f.ledger.reply(stranger, m.id, { prompt: 'Wrong' }), /recipient/);
    assert.throws(() => f.ledger.acknowledge(grace, m.id), /recipient/);
    assert.throws(() => f.ledger.request(ada, ada, { prompt: 'Loop' }), /another worker/);
    assert.throws(() => f.ledger.reply(ada, 'missing', { prompt: 'Bad' }), /request ID/);
    assert.equal(f.ledger.get(m.id)?.status, 'pending');
  } finally { f.close(); }
});

test('requests expire even after receipt, and expired requests reject replies', () => {
  const f = fixture();
  try {
    const m = f.ledger.request(grace, ada, { prompt: 'Short deadline', ttlMinutes: 1 });
    f.ledger.acknowledge(ada, m.id); f.advance(60_001);
    assert.equal(f.ledger.get(m.id)?.status, 'expired');
    assert.throws(() => f.ledger.reply(ada, m.id, { prompt: 'Late' }), /expired/);
    assert.throws(() => f.ledger.acknowledge(ada, m.id), /expired/);
  } finally { f.close(); }
});

test('idempotency keys survive restart and reject conflicting payloads', () => {
  const f = fixture();
  try {
    const m = f.ledger.request(grace, ada, { prompt: 'API ready', key: 'api-v1' });
    assert.equal(f.reload().request(grace, ada, { prompt: 'API ready', key: 'api-v1' }).id, m.id);
    assert.throws(() => f.ledger.request(grace, ada, { prompt: 'Different', key: 'api-v1' }), /different message/);
    const state = f.ledger.state(); state.messages[0].text = 'Modified';
    assert.equal(f.ledger.get(m.id)?.text, 'API ready', 'snapshots cannot mutate stored records');
  } finally { f.close(); }
});

test('malformed context and oversized messages fail without altering the ledger', () => {
  const f = fixture();
  try {
    for (const body of [{ prompt: '' }, { prompt: 'x'.repeat(4001) }, { prompt: 'Hello', ttlMinutes: 0 }, { prompt: 'Hello', context: { commit: 'main' } }, { prompt: 'Hello', context: { files: Array(21).fill('a') } }]) assert.throws(() => f.ledger.request(grace, ada, body));
    assert.equal(f.ledger.state().messages.length, 0);
    assert.throws(() => messageContext([]), /context/);
  } finally { f.close(); }
});

test('unresolved request cap bounds agent loops; expiration frees capacity', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 50; i++) f.ledger.request(grace, ada, { prompt: 'Question ' + i, ttlMinutes: 1 });
    assert.throws(() => f.ledger.request(grace, ada, { prompt: 'Over limit' }), /Too many/);
    f.advance(60_001);
    assert.equal(f.ledger.request(grace, ada, { prompt: 'New task' }).status, 'pending');
  } finally { f.close(); }
});

test('damaged history is refused without overwriting it', () => {
  const f = fixture();
  try {
    const file = path.join(f.dir, 'communications.json'); writeFileSync(file, 'broken');
    assert.throws(f.reload); assert.equal(readFileSync(file, 'utf8'), 'broken');
  } finally { f.close(); }
});

test('terminal communication view shows complete thread and handoff context', () => {
  const f = fixture();
  try {
    const m = f.ledger.request(grace, ada, { prompt: 'Fields for /users?' });
    f.ledger.reply(ada, m.id, { prompt: '{ id, email }', context: { branch: 'api/users', commit: 'abcdef1' } });
    const state: Dashboard = { view: { floor: null, workers: [], communications: f.ledger.state() } as unknown as FloorView, floors: [], selected: 0, panel: 'messages', offset: 0, notice: '', thread: m.id };
    const text = renderDashboard(state, 100, 30);
    assert.match(text, /Fields for \/users/); assert.match(text, /id, email/); assert.match(text, /api\/users/); assert.match(text, /abcdef1/);
  } finally { f.close(); }
});

test('retention removes completed threads together, preserving active requests', () => {
  const f = fixture();
  try {
    const active = f.ledger.request(stranger, ada, { prompt: 'Keep this active' });
    let first = '';
    for (let i = 0; i < 250; i++) {
      const request = f.ledger.request(grace, ada, { prompt: `Question ${i}` });
      first ||= request.id;
      const reply = f.ledger.reply(ada, request.id, { prompt: 'Answer' });
      f.ledger.acknowledge(grace, reply.id);
    }
    const state = f.reload().state();
    assert.ok(state.messages.length <= 500);
    assert.ok(state.messages.some((m) => m.id === active.id));
    assert.ok(!state.messages.some((m) => m.threadId === first), 'old completed request and all its replies are evicted together');
    assert.ok(state.messages.every((m) => state.messages.some((root) => root.id === m.threadId && root.kind === 'request')));
  } finally { f.close(); }
});

test('meeting links survive restart and retries across rounds; replies preserve the original round', () => {
  const f = fixture();
  try {
    const request = f.ledger.request(grace, ada, { prompt: 'Confirm contract', key: 'meeting-users' }, { id: 'meeting-1', round: 1 });
    const restored = f.reload();
    assert.deepEqual(restored.get(request.id)?.meeting, { id: 'meeting-1', round: 1 });
    const retry = restored.request(grace, ada, { prompt: 'Confirm contract', key: 'meeting-users' }, { id: 'meeting-1', round: 2 });
    assert.equal(retry.id, request.id);
    assert.equal(retry.meeting?.round, 1);
    const reply = restored.reply(ada, request.id, { prompt: 'id, name', meeting: { id: 'forged', round: 7 } });
    assert.deepEqual(reply.meeting, request.meeting);
    assert.deepEqual(f.reload().get(reply.id)?.meeting, request.meeting);
    const malformed = JSON.parse(readFileSync(path.join(f.dir, 'communications.json'), 'utf8'));
    malformed[0].meeting.round = 0;
    writeFileSync(path.join(f.dir, 'communications.json'), JSON.stringify(malformed));
    assert.throws(f.reload, /Invalid meeting link/);
  } finally { f.close(); }
});

test('helper report inbox acknowledgment completes without a reply; terminal delivery is mutually exclusive', () => {
  const f = fixture();
  try {
    const helper = { id: 'helper-1', name: 'Helper' };
    const report = f.ledger.report(helper, ada, 'Diagnosis: missing dependency', { branch: 'api' });
    assert.equal(f.ledger.inbox(ada).messages[0].status, 'delivered');
    assert.equal(f.ledger.get(report.id)?.status, 'delivered', 'reading does not clear the manual path');
    assert.throws(() => f.ledger.reply(ada, report.id, { prompt: 'Done' }), /Acknowledge a helper report/);
    f.ledger.acknowledge(ada, report.id);
    assert.equal(f.ledger.get(report.id)?.status, 'completed');
    assert.equal(f.ledger.get(report.id)?.helperReport?.handledVia, 'inbox');
    assert.throws(() => f.ledger.terminalReport(ada, report.id, 'claim'), /already handled/);
    const second = f.ledger.report({ id: 'helper-2', name: 'Helper' }, ada, 'Next finding', {});
    f.ledger.terminalReport(ada, second.id, 'claim');
    assert.throws(() => f.ledger.acknowledge(ada, second.id), /being delivered/);
    assert.throws(() => f.ledger.terminalReport(ada, second.id, 'claim'), /already in progress/);
    f.ledger.terminalReport(ada, second.id, 'release');
    assert.equal(f.ledger.get(second.id)?.status, 'pending');
    f.ledger.terminalReport(ada, second.id, 'claim');
    f.ledger.terminalReport(ada, second.id, 'complete');
    assert.equal(f.ledger.get(second.id)?.helperReport?.handledVia, 'terminal');
    assert.equal(f.ledger.get(second.id)?.acknowledgedAt, undefined, 'terminal submission does not fabricate agent acknowledgment');
    f.ledger.acknowledge(ada, second.id);
    assert.equal(f.ledger.get(second.id)?.helperReport?.handledVia, 'terminal', 'late acknowledgment does not rewrite the winning path');
    assert.equal(f.reload().get(second.id)?.status, 'completed');
    assert.throws(() => f.ledger.terminalReport(grace, report.id, 'claim'), /Unknown helper report/);
  } finally { f.close(); }
});
