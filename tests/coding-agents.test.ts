import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodingAgents } from '../src/server/coding-agents.js';
import { defaultCodingAgentsConfig, validCodingAgentsConfig } from '../src/shared/coding-agents.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

test('CodingAgents: loads defaults and validates configuration', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const ca = new CodingAgents(tmp);
  const state = ca.state();

  assert.ok(state.config.claude?.enabled);
  assert.equal(state.config.claude?.permissionMode, 'default');
  assert.ok(validCodingAgentsConfig(state.config));
  assert.ok(!validCodingAgentsConfig({ invalid_provider: { enabled: true } }));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CodingAgents: persists settings and publishes updates', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  let publishedState: any = null;
  const ca = new CodingAgents(tmp, (s) => {
    publishedState = s;
  });

  const updatedConfig = defaultCodingAgentsConfig();
  updatedConfig.claude = {
    enabled: true,
    permissionMode: 'auto-approve',
    model: 'opus',
    effort: 'high',
    extraArgs: ['--verbose'],
    env: { TEST_KEY: 'test_val' },
  };
  updatedConfig.opencode = {
    enabled: false,
    permissionMode: 'restricted',
    tools: { bash: 'deny', edit: 'ask', web: 'allow' },
  };

  const err = ca.set(updatedConfig, 'alice');
  assert.equal(err, undefined);
  assert.equal(publishedState?.by, 'alice');
  assert.equal(publishedState?.config.claude?.permissionMode, 'auto-approve');
  assert.equal(ca.isProviderEnabled('claude'), true);
  assert.equal(ca.isProviderEnabled('opencode'), false);
  assert.equal(ca.defaultModel('claude'), 'opus');
  assert.equal(ca.defaultEffort('claude'), 'high');

  // Verify reload from disk
  const reloaded = new CodingAgents(tmp);
  assert.equal(reloaded.isProviderEnabled('opencode'), false);
  assert.equal(reloaded.state().config.claude?.permissionMode, 'auto-approve');

  // Reset
  reloaded.reset('bob');
  assert.equal(reloaded.isProviderEnabled('opencode'), true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CodingAgents: enriches launch plan for Claude Code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const ca = new CodingAgents(tmp);

  const cfg = defaultCodingAgentsConfig();
  cfg.claude = {
    enabled: true,
    permissionMode: 'auto-approve',
    tools: { bash: 'deny' },
    extraArgs: ['--max-turns', '10'],
    env: { CUSTOM_VAR: 'enabled' },
  };
  ca.set(cfg, 'tester');

  const dummyInfo = { id: 'w1', provider: 'claude' } as WorkerInfo;
  const plan = { args: ['claude-bin'], env: {} };

  ca.applyLaunch('claude', plan, dummyInfo);

  assert.ok(plan.args.includes('--dangerously-skip-permissions'));
  assert.ok(plan.args.includes('--disallowedTools'));
  assert.ok(plan.args.includes('Bash'));
  assert.ok(plan.args.includes('--max-turns'));
  assert.equal(plan.env?.CUSTOM_VAR, 'enabled');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CodingAgents: enriches launch plan for OpenCode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const ca = new CodingAgents(tmp);

  const cfg = defaultCodingAgentsConfig();
  cfg.opencode = {
    enabled: true,
    permissionMode: 'auto-approve',
    extraArgs: ['--debug'],
  };
  ca.set(cfg, 'tester');

  const dummyInfo = { id: 'w2', provider: 'opencode' } as WorkerInfo;
  const plan: any = { args: ['opencode-bin'], finishEnv: (env: any) => {} };

  ca.applyLaunch('opencode', plan, dummyInfo);

  assert.ok(plan.args.includes('--debug'));

  const env: any = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ existing: true }) };
  plan.finishEnv(env);

  const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(parsed.permission?.['*'], 'allow');
  assert.equal(parsed.existing, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CodingAgents: enriches launch plan for Codex', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const ca = new CodingAgents(tmp);

  const cfg = defaultCodingAgentsConfig();
  cfg.codex = {
    enabled: true,
    permissionMode: 'restricted',
  };
  ca.set(cfg, 'tester');

  const dummyInfo = { id: 'w3', provider: 'codex' } as WorkerInfo;
  const plan = { args: ['codex-bin'] };

  ca.applyLaunch('codex', plan, dummyInfo);

  assert.ok(plan.args.includes('--sandbox'));
  assert.ok(plan.args.includes('read-only'));
  assert.ok(plan.args.includes('--ask-for-approval'));
  assert.ok(plan.args.includes('never'));

  fs.rmSync(tmp, { recursive: true, force: true });
});
