import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationCheckpoints } from '../src/server/communication-checkpoints.js';
import type { WorkerMessage } from '../src/shared/communications.js';

const message = (id = 'request-1'): WorkerMessage => ({ id, threadId: id, kind: 'request', from: { id: 'grace', name: 'Grace' }, to: { id: 'ada', name: 'Ada' }, text: 'What fields does /users return?', context: {}, at: 0, expiresAt: 999999, status: 'pending' });
test('queued messages surface after a tool during the current task without a receipt or interruption', () => {
  let now = 1000;
  const checkpoints = new CommunicationCheckpoints(() => now), state = { messages: [message()] };
  assert.deepEqual(checkpoints.output('ada', 'PreToolUse', state), {});
  assert.deepEqual(checkpoints.output('grace', 'PostToolUse', state), {});
  const result = checkpoints.output('ada', 'PostToolUse', state) as any;
  assert.equal(result.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(result.hookSpecificOutput.additionalContext, /CURRENT task/);
  assert.match(result.hookSpecificOutput.additionalContext, /request-1/);
  assert.equal(state.messages[0].status, 'pending');
  assert.deepEqual(checkpoints.output('ada', 'PostToolUse', state), {});
  now += 30000;
  assert.ok(checkpoints.output('ada', 'PostToolUse', state).hookSpecificOutput);
  state.messages.push(message('request-2'));
  assert.ok(checkpoints.output('ada', 'PostToolUse', state).hookSpecificOutput, 'new messages bypass reminder interval');
});
test('Stop requests one continuation per outstanding set and prevents hook loops', () => {
  const checkpoints = new CommunicationCheckpoints(), state = { messages: [message()] };
  assert.equal(checkpoints.output('ada', 'Stop', state).decision, 'block');
  assert.deepEqual(checkpoints.output('ada', 'Stop', state), {});
  assert.deepEqual(new CommunicationCheckpoints().output('ada', 'Stop', state, true), {});
  state.messages.push(message('request-2'));
  assert.equal(checkpoints.output('ada', 'Stop', state).decision, 'block');
});
test('answered/completed/expired messages and terminal-claimed helper reports do not nag', () => {
  for (const status of ['answered', 'completed', 'expired'] as const) {
    assert.deepEqual(new CommunicationCheckpoints().output('ada', 'PostToolUse', { messages: [{ ...message(), status }] }), {});
  }
  assert.deepEqual(new CommunicationCheckpoints().output('ada', 'PostToolUse', { messages: [{ ...message(), helperReport: { workerId: 'helper', terminalClaimed: true } }] }), {});
  assert.ok(new CommunicationCheckpoints().output('ada', 'PostToolUse', { messages: [{ ...message(), kind: 'reply', status: 'delivered' }] }).hookSpecificOutput);
});
