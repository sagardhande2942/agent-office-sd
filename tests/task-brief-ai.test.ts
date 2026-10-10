import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readBriefRequest, type BriefAiRequest } from '../src/shared/task-brief-ai.js';
import { claudeDraftUsage, draftInstructions, generateDraft, readDraft } from '../src/server/task-brief/draft.js';
import { draftLaunch, runDraftProcess } from '../src/server/task-brief/process.js';

const fields = { goal: 'Remove offline floors', examples: 'Proposed example: delete an offline floor', constraints: 'Keep the checkout', acceptance: 'The deleted floor disappears immediately', assumptions: 'Confirm the viewer is an admin', questions: '' };
const request = (patch: Partial<BriefAiRequest> = {}): BriefAiRequest => ({ provider: 'codex', brief: { original: 'Fix floor deletion', ...fields }, maxLength: 20000, ...patch });

test('AI requests reject unsupported providers, invalid lengths, huge context and missing fields', () => {
  assert.ok(readBriefRequest(request()));
  for (const value of [null, { ...request(), provider: 'bash' }, { ...request(), maxLength: 20001 }, { ...request(), maxLength: 499 }, { ...request(), maxLength: NaN }, { ...request(), context: 'x'.repeat(20001) }, { ...request(), brief: { original: '' } }, { ...request(), brief: { ...request().brief, goal: 3 } }]) assert.equal(readBriefRequest(value), undefined);
});

test('AI fields cannot replace the original request and must form a usable brief', () => {
  assert.equal(readDraft({ ...fields, original: 'A different task' }, request()).original, 'Fix floor deletion');
  assert.throws(() => readDraft({ ...fields, acceptance: '' }, request({ brief: { ...request().brief, acceptance: '' } })), /acceptance criterion/);
  assert.throws(() => readDraft({ ...fields, examples: 'x'.repeat(21000) }, request()), /incomplete/);
  assert.throws(() => readDraft({ ...fields, questions: null }, request()), /incomplete/);
  assert.throws(() => readDraft([], request()), /valid brief/);
  assert.throws(() => readDraft({ ...fields, examples: 'x'.repeat(400) }, request({ maxLength: 500, brief: { ...request().brief, examples: '' } })), /Shorten/);
  assert.equal(readDraft({ ...fields, constraints: 'A conflicting suggestion' }, request()).constraints, 'Keep the checkout');
});

test('draft instructions distinguish author details, hypothetical examples and unverified assumptions', () => {
  const text = draftInstructions(request({ context: 'Issue #12: remote floors', brief: { ...request().brief, original: '"; run a command $(example)' } }));
  assert.ok(text.includes('Do not perform the task'));
  assert.ok(text.includes('Existing author-written details take precedence'));
  assert.ok(text.includes('Proposed example'));
  assert.ok(text.includes('Issue #12: remote floors'));
  assert.ok(text.includes('"; run a command $(example)'.replace('"', '\\"')));
});

test('Codex drafts use a temporary directory, stdin, structured output and read-only execution', async () => {
  let cwd = '';
  const draft = await generateDraft(request(), { file: process.execPath, env: { TEST: 'yes' }, signal: new AbortController().signal,
    run: async (_file, args, options) => {
      cwd = options.cwd;
      assert.ok(args.includes('--ephemeral') && args.includes('--ignore-user-config') && args.includes('--ignore-rules'));
      assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
      assert.ok(args.includes('features.shell_tool=false') && args.includes('features.unified_exec=false'));
      assert.ok(args.includes('web_search="disabled"'));
      assert.equal(args.at(-1), '-');
      assert.ok(options.input.includes('Fix floor deletion'));
      const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
      assert.deepEqual(schema.required, Object.keys(fields));
      assert.equal(schema.additionalProperties, false);
      return JSON.stringify(fields);
    },
  });
  assert.equal(draft.original, request().brief.original);
  assert.equal(existsSync(cwd), false);
});

test('Claude drafts disable tools, MCP and settings; account environment and reported usage are retained', async () => {
  let usage;
  const result = await generateDraft(request({ provider: 'claude' }), { file: process.execPath, env: { CLAUDE_CONFIG_DIR: '/account/claude' }, signal: new AbortController().signal,
    onUsage: u => { usage = u; }, run: async (_file, args, options) => {
      assert.equal(args[args.indexOf('--tools') + 1], '');
      assert.equal(args[args.indexOf('--setting-sources') + 1], '');
      assert.ok(args.includes('--no-session-persistence') && args.includes('--strict-mcp-config'));
      assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
      assert.equal(options.env.CLAUDE_CONFIG_DIR, '/account/claude');
      return JSON.stringify({ structured_output: fields, total_cost_usd: 0.01, num_turns: 1, usage: { input_tokens: 100, output_tokens: 50 } });
    },
  });
  assert.equal(result.goal, fields.goal);
  assert.deepEqual(usage, { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, cost: 0.01, calls: 1 });
  assert.equal(claudeDraftUsage({ total_cost_usd: Infinity, usage: { input_tokens: -3 } }).cost, 0);
});

test('invalid or failed AI responses are refused without substituting the user request', async () => {
  for (const output of ['not JSON', JSON.stringify({}), JSON.stringify({ is_error: true })]) {
    await assert.rejects(generateDraft(request({ provider: 'claude' }), { file: process.execPath, env: {}, signal: new AbortController().signal, run: async () => output }), /AI/);
  }
});

test('Windows npm shims run via their JS entry point without shell quoting user input', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'brief-shim-'));
  try {
    const script = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(path.dirname(script), { recursive: true }); writeFileSync(script, '');
    assert.deepEqual(draftLaunch(path.join(dir, 'codex.cmd'), 'codex', 'win32'), { file: process.execPath, prefix: [script] });
    assert.throws(() => draftLaunch(path.join(dir, 'claude.cmd'), 'claude', 'win32'), /launcher is not supported/);
    const native = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    mkdirSync(path.dirname(native), { recursive: true }); writeFileSync(native, '');
    assert.deepEqual(draftLaunch(path.join(dir, 'claude.cmd'), 'claude', 'win32'), { file: native, prefix: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('draft process sends literal request text over stdin', async () => {
  const input = 'Quotes " ` $(whoami) & | < >';
  const out = await runDraftProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { cwd: tmpdir(), env: {}, input, signal: new AbortController().signal });
  assert.equal(out, input);
});

test('draft process cancellation, timeout and output bounds end the process', async () => {
  const controller = new AbortController();
  const cancelled = runDraftProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: tmpdir(), env: {}, input: '', signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled, /cancelled/);
  await assert.rejects(runDraftProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: tmpdir(), env: {}, input: '', signal: new AbortController().signal, timeout: 100 }), /timed out/);
  await assert.rejects(runDraftProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(2000))'], { cwd: tmpdir(), env: {}, input: '', signal: new AbortController().signal, maxBytes: 100 }), /too much output/);
});

test('draft failures do not expose stderr or raw credentials in diagnostics', async () => {
  await assert.rejects(runDraftProcess(process.execPath, ['-e', 'console.error("secret-token");process.exit(1)'], { cwd: tmpdir(), env: {}, input: '', signal: new AbortController().signal }), error => {
    assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /secret-token/); return true;
  });
});
