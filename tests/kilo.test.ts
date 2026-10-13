import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addKiloConfig, kiloArgs, removeKiloConfig } from '../src/server/kilo.js';
import { kilo } from '../src/server/providers/kilo.js';
import { providerHook } from '../src/server/providers/index.js';
import { fetchKiloModels } from '../src/server/models.js';
import { configuredProvider, providerCommand, validateWorkerEffort, validateWorkerModel } from '../src/server/agents.js';
import { PROVIDER_META, providerNames } from '../src/shared/providers.js';

const PLUGIN = 'file:///floor/.agent-office/agent-office-opencode.mjs';
const MCP = { 'agent-office': { type: 'local', command: [process.execPath, '/office/bin/office-workers.js', 'mcp'], enabled: true } };
const withTemp = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-kilo-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const config = (dir: string, name = 'kilo.json') => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

test('the Kilo CLI is a provider of its own, taking a provider/model and an effort', () => {
  for (const cmd of ['kilo', '/opt/bin/kilo', 'C:\\bin\\kilo.exe']) assert.equal(configuredProvider(cmd), 'kilo');
  assert.equal(configuredProvider('kilocode'), 'custom');
  assert.equal(providerCommand('kilo', 'claude'), 'kilo');
  assert.equal(PROVIDER_META.kilo.bin, 'kilo');
  assert.equal(validateWorkerModel('agent', 'kilo', 'kilo/anthropic/claude-opus-5.5'), undefined);
  assert.equal(validateWorkerModel('agent', 'kilo', 'kilo/~anthropic/claude-opus-latest'), undefined);
  assert.match(validateWorkerModel('agent', 'kilo', '--model=bad') ?? '', /Invalid Kilo model/);
  assert.match(validateWorkerModel('agent', 'kilo', 'kilo/anthropic claude') ?? '', /Invalid Kilo model/);
  assert.equal(validateWorkerEffort('agent', 'kilo', 'max'), undefined);
  assert.match(validateWorkerEffort('agent', 'kilo', 'enormous') ?? '', /Invalid effort/);
  assert.match(providerNames((m) => !!m.validModel), /Antigravity or Kilo/);
});

test("Kilo's command line keeps the office's agent args and drops the flags the office sets itself", () => {
  assert.deepEqual(kiloArgs(['--print-logs', '--log-level', 'DEBUG', '--auto', '--pure', '-c', '--continue', '-mold', '--prompt', 'stale'], { model: 'kilo/x', prompt: 'Do the work', sessionId: 'ses_1' }),
    ['--print-logs', '--log-level', 'DEBUG', '--session', 'ses_1', '--model', 'kilo/x', '--prompt', 'Do the work']);
  assert.deepEqual(kiloArgs(['--sandbox', '--agent', 'build', '--model=kilo/y'], {}), ['--sandbox']);
  assert.deepEqual(kiloArgs(['--', '--auto'], {}), []);
  assert.deepEqual(kiloArgs(['--fork', '--cloud-fork', '--share'], { model: 'kilo/z' }), ['--model', 'kilo/z']);
});

test('the workspace config gains the office plugin and MCP server, and gives them back', () => {
  withTemp((dir) => {
    assert.equal(addKiloConfig(dir, { plugin: PLUGIN, mcp: MCP }), true);
    assert.deepEqual(config(dir).plugin, [PLUGIN]);
    assert.deepEqual(config(dir).mcp, MCP);
    // A second worker on the same checkout shares the one entry; it leaves when the last one does.
    assert.equal(addKiloConfig(dir, { plugin: PLUGIN, mcp: MCP }), true);
    removeKiloConfig(dir);
    assert.deepEqual(config(dir).plugin, [PLUGIN]);
    removeKiloConfig(dir);
    assert.equal(existsSync(path.join(dir, 'kilo.json')), false);
  });
});

test("Kilo's own $schema in a file the office made is no reason to leave it behind", () => {
  withTemp((dir) => {
    assert.equal(addKiloConfig(dir, { plugin: PLUGIN, mcp: MCP }), true);
    // What Kilo writes into a workspace config it reads, as it does on its own.
    writeFileSync(path.join(dir, 'kilo.json'), JSON.stringify({ $schema: 'https://app.kilo.ai/config.json', plugin: [PLUGIN], mcp: MCP }, null, 2));
    removeKiloConfig(dir);
    assert.equal(existsSync(path.join(dir, 'kilo.json')), false);
  });
});

test("a project's own Kilo config is preserved, and a .jsonc is the one Kilo reads first", () => {
  withTemp((dir) => {
    const original = '{\n  "model": "kilo/anthropic/claude-opus-5.5",\n  "plugin": ["file:///project/plugin.mjs"],\n  "mcp": { "project": { "type": "local", "command": ["node", "project.js"] } }\n}\n';
    writeFileSync(path.join(dir, 'kilo.json'), original);
    assert.equal(addKiloConfig(dir, { plugin: PLUGIN, mcp: MCP }), true);
    assert.deepEqual(config(dir).plugin, ['file:///project/plugin.mjs', PLUGIN]);
    removeKiloConfig(dir);
    assert.equal(readFileSync(path.join(dir, 'kilo.json'), 'utf8'), original);

    withTemp((other) => {
      const jsonc = '{\n  "model": "kilo/anthropic/claude-opus-5.5"\n}\n';
      writeFileSync(path.join(other, 'kilo.jsonc'), jsonc);
      assert.equal(addKiloConfig(other, { plugin: PLUGIN }), true);
      assert.ok(config(other, 'kilo.jsonc').plugin.includes(PLUGIN));
      assert.equal(existsSync(path.join(other, 'kilo.json')), false);
      removeKiloConfig(other);
      assert.equal(readFileSync(path.join(other, 'kilo.jsonc'), 'utf8'), jsonc);
    });
  });
});

test('a Kilo config the office cannot parse fails the launch instead of losing the bridge', () => {
  withTemp((dir) => {
    const comments = '{\n  // Kilo reads this file; JSON.parse cannot.\n  "model": "kilo/anthropic/claude-opus-5.5"\n}\n';
    writeFileSync(path.join(dir, 'kilo.jsonc'), comments);
    assert.equal(addKiloConfig(dir, { plugin: PLUGIN }), false);
    assert.equal(readFileSync(path.join(dir, 'kilo.jsonc'), 'utf8'), comments);
  });
});

test('the adapter runs Kilo with the office plugin installed, and its effort through that plugin', () => {
  withTemp((dir) => {
    const setup = kilo.prepare!({ dataDir: dir, mcpScript: '/office/bin/office-workers.js', dshProfile: 'acp' });
    assert.ok(setup.plugin.endsWith('agent-office-opencode.mjs'));
    assert.deepEqual(setup.mcp, MCP);
    const h: any = { info: { id: 'worker', model: 'kilo/anthropic/claude-opus-5.5', effort: 'high', planReview: { locked: true } }, state: {} };
    const launch = kilo.launch({ h, args: [], prompt: 'Do the work', cwd: dir, setup });
    assert.deepEqual(launch.args, ['--model', 'kilo/anthropic/claude-opus-5.5', '--prompt', 'Do the work', '--agent', 'plan']);
    assert.equal(launch.rotateToken, true);
    const env: Record<string, string> = {};
    launch.finishEnv!(env);
    assert.equal(env.AGENT_OFFICE_EFFORT, 'high');
    assert.equal(env.AGENT_OFFICE_MODEL, 'kilo/anthropic/claude-opus-5.5');
    assert.equal(env.AGENT_OFFICE_SESSION_ID, '');
    assert.ok(config(dir).plugin.includes(setup.plugin));
    assert.ok(setup.plugin.startsWith('file://'));

    kilo.exited!(h, dir);
    assert.equal(existsSync(path.join(dir, 'kilo.json')), false);

    // A resumed session carries on with the conversation it had: no model, no effort, its own id.
    const back: any = { info: { id: 'worker', model: 'kilo/anthropic/claude-opus-5.5', effort: 'high' }, state: {} };
    const again = kilo.launch({ h: back, args: [], prompt: 'And now?', resumeSessionId: 'ses_1', cwd: dir, setup });
    assert.deepEqual(again.args, ['--session', 'ses_1', '--prompt', 'And now?']);
    const resumed: Record<string, string> = {};
    again.finishEnv!(resumed);
    assert.equal(resumed.AGENT_OFFICE_EFFORT, '');
    assert.equal(resumed.AGENT_OFFICE_MODEL, '');
    assert.equal(resumed.AGENT_OFFICE_SESSION_ID, 'ses_1');

    kilo.exited!(back, dir);
    assert.equal(existsSync(path.join(dir, 'kilo.json')), false);
  });
});

test('Kilo speaks OpenCode\u2019s plugin bridge, so its workers report where OpenCode\u2019s do', () => {
  assert.equal(kilo.hooksAs, 'opencode');
  assert.ok(providerHook('opencode'));
  assert.equal(providerHook('kilo'), undefined);
  assert.equal(kilo.transport, undefined, 'Kilo runs in the office\u2019s terminal, not over ACP');
  assert.equal(kilo.titleNoise!.test('Kilo CLI'), true);
  assert.equal(kilo.titleNoise!.test('kilocode'), true);
  assert.equal(kilo.titleNoise!.test('Kilo Gateway'), false);
  assert.match(kilo.screen!.blocked!('You need to sign in to use this model', true) ?? '', /\/connect/);
  assert.equal(kilo.screen!.blocked!('claude-opus-5.5 \u00b7 1.2M tokens', false), undefined);
});

test("Kilo's model catalogue is read from its own CLI, with the variants it lists", async () => {
  const verbose = ['kilo/anthropic/claude-opus-5.5', '{', '  "id": "anthropic/claude-opus-5.5",', '  "name": "Anthropic: Claude Opus 5.5",', '  "variants": {', '    "low": {},', '    "high": {},', '    "ultra": {}', '  }', '}'].join('\n');
  const asked: string[][] = [];
  const models = await fetchKiloModels('kilo', '/tmp', async (_file, args) => {
    asked.push(args);
    return { stdout: verbose, stderr: '' };
  });
  assert.deepEqual(asked, [['models', '--verbose']]);
  assert.deepEqual(models, [{ id: 'kilo/anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5', efforts: ['low', 'high'] }]);

  const plain = await fetchKiloModels('kilo', '/tmp', async (_file, args) => {
    asked.push(args);
    if (args.includes('--verbose')) throw new Error('no details');
    return { stdout: 'kilo/moonshotai/kimi-k2.5\nkilo/z-ai/glm-5.3\nnot a model\n', stderr: '' };
  });
  assert.deepEqual(plain.map((m) => m.id), ['kilo/moonshotai/kimi-k2.5', 'kilo/z-ai/glm-5.3']);
  await assert.rejects(fetchKiloModels('kilo', '/tmp', async () => { throw new Error('kilo: not found'); }), /Kilo model catalogue unavailable/);
});
