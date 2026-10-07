import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { antigravityArgs, addAntigravityHooks, removeAntigravityHooks, normalizeAntigravityHook, writeAntigravityHook } from '../src/server/antigravity.js';
import { antigravity } from '../src/server/providers/antigravity.js';
import { configuredProvider, providerCommand, validateWorkerModel, validateWorkerEffort } from '../src/server/agents.js';

test('Antigravity is detected by its executable and validates model and effort choices', () => {
  for (const cmd of ['agy', '/opt/bin/agy', 'C:\\bin\\agy.exe']) assert.equal(configuredProvider(cmd), 'antigravity');
  assert.equal(configuredProvider('antigravity'), 'custom');
  assert.equal(providerCommand('antigravity', 'claude'), 'agy');
  assert.equal(validateWorkerModel('agent', 'antigravity', 'gemini-3.6-flash-medium'), undefined);
  assert.ok(validateWorkerModel('agent', 'antigravity', '--model=bad'));
  assert.equal(validateWorkerEffort('agent', 'antigravity', 'max'), undefined);
  assert.deepEqual(antigravityArgs(['--model=old', '--print', 'old prompt', '--continue', '--dangerously-skip-permissions', '--sandbox'], 'gemini-model', 'high', 'root'), ['--sandbox', '--conversation', 'root', '--model', 'gemini-model', '--effort', 'high']);
});

test('workspace hooks preserve project hooks, shared desks and original formatting', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-agy-'));
  try {
    mkdirSync(path.join(dir, '.agents'));
    const file = path.join(dir, '.agents/hooks.json');
    const original = '{"project":{"Stop":[{"command":"echo project"}]}}\n';
    writeFileSync(file, original);
    const helper = writeAntigravityHook(dir);
    assert.equal(addAntigravityHooks(dir, helper, 'one'), true);
    assert.equal(addAntigravityHooks(dir, helper, 'two'), true);
    const hooks = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(hooks['agent-office-antigravity-one'].PreToolUse[0].matcher, '*');
    assert.equal(hooks['agent-office-antigravity-one'].PreInvocation[0].type, 'command');
    removeAntigravityHooks(dir, 'one');
    assert.ok(JSON.parse(readFileSync(file, 'utf8'))['agent-office-antigravity-two']);
    removeAntigravityHooks(dir, 'two');
    assert.equal(readFileSync(file, 'utf8'), original);
    writeFileSync(file, '{bad');
    assert.equal(addAntigravityHooks(dir, helper, 'one'), false);
    assert.equal(readFileSync(file, 'utf8'), '{bad');
    rmSync(file);
    assert.equal(addAntigravityHooks(dir, helper, 'one'), true);
    removeAntigravityHooks(dir, 'one');
    assert.equal(existsSync(file), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('launch uses interactive initial prompt and exact conversation resume with native approvals', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-agy-launch-'));
  try {
    const h: any = { info: { id: 'worker', model: 'gemini-model', effort: 'max', planReview: { locked: true } } };
    const setup = antigravity.prepare!({ dataDir: dir, dshProfile: 'acp' });
    const launch = antigravity.launch({ h, args: [], prompt: 'Do the work', resumeSessionId: 'root', cwd: dir, setup });
    assert.deepEqual(launch.args, ['--conversation', 'root', '--model', 'gemini-model', '--effort', 'max', '--mode', 'plan', '--prompt-interactive', 'Do the work']);
    assert.equal(launch.rotateToken, true);
    antigravity.exited!(h, dir);
    assert.equal(existsSync(path.join(dir, '.agents/hooks.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hooks discard tool content and reject foreign conversations and malformed payloads', () => {
  assert.deepEqual(normalizeAntigravityHook('PreInvocation', { conversationId: 'root', transcriptPath: '/secret' }), { sessionId: 'root', event: 'UserPromptSubmit' });
  assert.equal(normalizeAntigravityHook('Stop', { conversationId: '--bad' }), undefined);
  assert.equal(normalizeAntigravityHook('Stop', { conversationId: 'child', parentConversationId: 'root' }), undefined);
  const h: any = { info: { sessionId: 'root', status: 'working' }, setStatus: (s: string) => h.info.status = s, emit() {}, persist() {} };
  assert.equal(antigravity.hook!.handle(h, 'Stop', { conversationId: 'child' }), false);
  assert.equal(antigravity.hook!.handle(h, 'Stop', { conversationId: 'root' }), true);
  assert.equal(h.info.status, 'done');
  const dir = mkdtempSync(path.join(tmpdir(), 'office-agy-helper-'));
  try {
    const helper = writeAntigravityHook(dir);
    assert.equal(execFileSync(process.execPath, [helper, 'Stop', 'one'], { input: '{bad', env: { ...process.env, AGENT_OFFICE_WORKER_ID: 'one' }, encoding: 'utf8' }), '{}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
