import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityToolSignals } from '../src/server/activity-heatmap-signals/index.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
const worker = { id: 'w', sessionId: 's' } as WorkerInfo;
const data = (id: string, tool = 'Bash', input: unknown = { command: 'npm test' }) => ({ session_id: 's', tool_use_id: id, tool_name: tool, tool_input: input });
test('actual paired check boundaries survive duplicate and parallel tools with check precedence', () => {
  const seen: unknown[] = [], signals = new ActivityToolSignals((id, phase) => seen.push([id, phase]));
  signals.hook(worker, 'claude', 'PreToolUse', data('check'));
  signals.hook(worker, 'claude', 'PreToolUse', data('check'));
  signals.hook(worker, 'claude', 'PreToolUse', data('edit', 'Edit'));
  signals.hook(worker, 'claude', 'PostToolUse', data('check'));
  signals.hook(worker, 'claude', 'PostToolUseFailure', data('edit', 'Edit'));
  assert.deepEqual(seen, [['w', 'checks'], ['w', 'checks'], ['w', 'implementation'], ['w', null]]);
});
test('Codex command input is unavailable; edit tools are measured, foreign and child sessions ignored', () => {
  const seen: unknown[] = [], signals = new ActivityToolSignals((id, phase) => seen.push([id, phase]));
  signals.hook(worker, 'codex', 'PreToolUse', data('command', 'exec_command'));
  signals.hook(worker, 'codex', 'PreToolUse', data('edit', 'apply_patch'));
  signals.hook(worker, 'codex', 'PostToolUse', { ...data('edit'), agent_id: 'child' });
  signals.hook(worker, 'codex', 'PostToolUse', { ...data('edit'), session_id: 'foreign' });
  signals.hook(worker, 'codex', 'Stop', { session_id: 's' });
  assert.deepEqual(seen, [['w', null], ['w', 'implementation'], ['w', null]]);
});
test('missing tool ids and unsupported providers never infer check time from text', () => {
  const seen: unknown[] = [], signals = new ActivityToolSignals((id, phase) => seen.push([id, phase]));
  signals.hook(worker, 'claude', 'PreToolUse', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  signals.hook(worker, 'opencode', 'PreToolUse', data('check'));
  assert.deepEqual(seen, []);
});
