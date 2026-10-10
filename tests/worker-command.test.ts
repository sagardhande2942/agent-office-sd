import test from 'node:test';
import assert from 'node:assert/strict';
import { missingAgentCommand } from '../src/server/workers/process.js';

test('missing Windows agents report local installation instructions before any Unix fallback', () => {
  assert.match(missingAgentCommand('claude', null, 'win32', '')!, /claude is not on this machine's PATH/);
  assert.match(missingAgentCommand('codex', undefined, 'win32', '')!, /restart the office or floor-host/);
  assert.equal(missingAgentCommand('claude', 'C:\\tools\\claude.exe', 'win32', ''), undefined);
  assert.equal(missingAgentCommand('claude', null, 'linux', ''), undefined);
  assert.equal(missingAgentCommand('claude', null, 'win32', '/bin/bash'), undefined);
});