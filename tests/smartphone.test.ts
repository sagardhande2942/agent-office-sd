import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSms, logRecent, MAX_KEYS, MAX_RECENTS, MAX_SMS_TEXT, MAX_THREAD, pruneThreadKeys, threadKey } from '../src/shared/smartphone.js';
import type { SmsMsg } from '../src/shared/smartphone.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { contactSub, dotColor, kindIcon, messageBlockReason, statusNote } from '../src/client/features/smartphone/logic.js';

test('threads are keyed by floor and worker, and capped', () => {
  assert.equal(threadKey('f1', 'w1'), 'f1/w1');
  assert.equal(threadKey(null, 'w1'), 'lobby/w1');
  let thread = appendSms(undefined, 'hello');
  assert.deepEqual(thread.map((m) => [m.dir, m.text]), [['out', 'hello']]);
  for (let i = 0; i < MAX_THREAD + 5; i++) thread = appendSms(thread, `m${i}`, i % 2 ? 'note' : 'out');
  assert.equal(thread.length, MAX_THREAD);
  assert.equal(thread[0].text, 'm5');
});

test('recents put the latest first, one line per worker and kind, and are capped', () => {
  const at = Date.now();
  let recents = logRecent([], { kind: 'sms', workerId: 'a', name: 'A', at });
  recents = logRecent(recents, { kind: 'call', workerId: 'a', name: 'A', at });
  recents = logRecent(recents, { kind: 'sms', workerId: 'b', name: 'B', at });
  assert.deepEqual(
    recents.map((r) => [r.kind, r.workerId]),
    [
      ['sms', 'b'],
      ['call', 'a'],
      ['sms', 'a'],
    ],
  );
  // Texting A again moves only its SMS line to the top.
  recents = logRecent(recents, { kind: 'sms', workerId: 'a', name: 'A', at });
  assert.deepEqual(
    recents.map((r) => [r.kind, r.workerId]),
    [
      ['sms', 'a'],
      ['sms', 'b'],
      ['call', 'a'],
    ],
  );
  for (let i = 0; i < MAX_RECENTS + 5; i++) recents = logRecent(recents, { kind: 'sms', workerId: `w${i}`, name: `W${i}`, at });
  assert.equal(recents.length, MAX_RECENTS);
});

test('only plain hex colors reach the stylesheet, anything else falls back', () => {
  assert.equal(dotColor({ color: '#4f86f7' }), '#4f86f7');
  assert.equal(dotColor({ color: '#ABCDEF' }), '#ABCDEF');
  for (const bad of ['', 'red', '#fff', '#gggggg', '#1234567', 'a;#x{background:url(//evil)}', '#4f86f7;foo:bar']) assert.equal(dotColor({ color: bad }), '#888888', bad);
});

test('the in-memory map is kept to the same cap, quietest first', () => {
  const threads: Record<string, SmsMsg[]> = {};
  for (let i = 0; i < MAX_KEYS + 5; i++) threads[`f1/w${i}`] = [{ dir: 'out', text: `m${i}`, at: i }];
  const pruned = pruneThreadKeys(threads);
  assert.equal(Object.keys(pruned).length, MAX_KEYS);
  assert.ok(!('f1/w0' in pruned) && !('f1/w4' in pruned) && 'f1/w5' in pruned);
  const few: Record<string, SmsMsg[]> = { a: [{ dir: 'out', text: 'x', at: 1 }] };
  assert.equal(pruneThreadKeys(few), few);
});

test("a contact row names what it's on, and a lost worktree says how to fix it", () => {
  assert.equal(kindIcon({ kind: 'agent' }), '🤖');
  assert.equal(kindIcon({ kind: 'shell' }), '🐚');
  assert.equal(contactSub({ activity: 'Wants permission: npm test' }), 'Wants permission: npm test');
  // Work standing is the badge's job, never the sub line's (no double 🔀).
  assert.equal(contactSub({}), undefined);
  assert.equal(contactSub({ lost: { branch: 'here' } }), '🌿 worktree deleted — tap to fix it');
});

test('busy status never claims a message was delivered', () => {
  for (const status of ['working', 'starting', 'idle', 'done', 'needs_input', 'offline', 'exited'] as const) {
    assert.ok(!statusNote({ name: 'Byte', status }).includes('delivered'));
  }
  assert.match(statusNote({name:'Byte',status:'working'}), /may queue/);
});

test('messages cannot overwrite approvals, run shell commands, or reach unavailable sessions', () => {
  for (const status of ['needs_input', 'starting', 'offline', 'exited'] as const) assert.ok(messageBlockReason({kind:'agent',status}));
  assert.ok(messageBlockReason({kind:'shell',status:'idle'}));
  assert.ok(messageBlockReason({kind:'agent',status:'working',lost:{branch:'gone'}}));
  assert.equal(messageBlockReason({kind:'agent',status:'working'}),undefined);
  assert.equal(messageBlockReason({kind:'agent',status:'idle'}),undefined);
});

test('helper contacts identify their host', () => {
  assert.equal(contactSub({helper:{hostId:'host',hostName:'Byte'}}), 'Helping Byte');
});
