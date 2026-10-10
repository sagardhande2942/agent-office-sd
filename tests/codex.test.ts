import { codexBlocked } from '../src/server/providers/codex-screen.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CODEX_HOOK_EVENTS,
  codexHookArgs,
  codexHookCommand,
  codexModelArgs,
  normalizeCodexHook,
  validateCodexHook,
  writeCodexHook,
} from '../src/server/codex.js';
import { codex } from '../src/server/providers/codex.js';

test('normalizes bounded root Codex hook payloads and passes only the metric reader path', () => {
  assert.deepEqual(normalizeCodexHook('SessionStart', {
    session_id: 'thread-1', source: 'startup', transcript_path: '/private/transcript.jsonl', turn_id: 'turn-1',
  }), { sessionId: 'thread-1', event: 'SessionStart', source: 'startup', turnId: 'turn-1', transcriptPath: '/private/transcript.jsonl' });
  assert.deepEqual(normalizeCodexHook('UserPromptSubmit', {
    session_id: 'thread-1', prompt: '  fix the login  ', turn_id: 'turn-2', model: 'secret-model',
  }), { sessionId: 'thread-1', event: 'UserPromptSubmit', prompt: 'fix the login', turnId: 'turn-2' });
  assert.deepEqual(normalizeCodexHook('PermissionRequest', {
    session_id: 'thread-1', tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: { command: 'secret' },
  }), { sessionId: 'thread-1', event: 'PermissionRequest', tool: 'Bash', toolUseId: 'tool-1' });
});

test('rejects unknown, malformed, empty, oversized, and child-scoped events', () => {
  assert.equal(validateCodexHook('Unknown', { session_id: 'x' }), false);
  assert.equal(validateCodexHook('Stop', null), false);
  assert.equal(validateCodexHook('Stop', { session_id: '' }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x'.repeat(161) }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x', agent_id: 'child-1' }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x', agent_type: 'explorer' }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x', agent_id: 'c'.repeat(161) }), false);
});

test('generates one stable CLI hook override per supported event', () => {
  const args = codexHookArgs('/tmp/office data/agent-office-codex-hook.cjs');
  assert.equal(args.length, CODEX_HOOK_EVENTS.length * 2);
  for (let i = 0; i < CODEX_HOOK_EVENTS.length; i++) {
    assert.equal(args[i * 2], '-c');
    assert.match(args[i * 2 + 1], new RegExp(`^hooks\\.${CODEX_HOOK_EVENTS[i]}=\\[\\{hooks=`));
    assert.match(args[i * 2 + 1], /type="command"/);
    assert.match(args[i * 2 + 1], /timeout=3/);
    const encoded = args[i * 2 + 1].match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
    assert.match(encoded ? Buffer.from(encoded, 'base64').toString('utf16le') : args[i * 2 + 1], /agent-office-codex-hook\.cjs/);
  }
});

test('Windows hook commands safely encode paths for cmd and PowerShell', () => {
  const command = codexHookCommand("C:\\Alice's office\\%PATH% & $test`\\hook.cjs", 'Stop', 'win32', 'C:\\Program Files\\node.exe');
  assert.match(command, /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
  const script = Buffer.from(command.split(' ').at(-1)!, 'base64').toString('utf16le');
  assert.equal(script, "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); & 'C:\\Program Files\\node.exe' 'C:\\Alice''s office\\%PATH% & $test`\\hook.cjs' 'Stop'; exit $LASTEXITCODE");
  assert.equal(codexHookCommand('/tmp/office data/hook.cjs', 'Stop', 'linux', '/usr/bin/node'), "'/usr/bin/node' '/tmp/office data/hook.cjs' 'Stop'");
});

test('native Windows shells execute generated hooks and preserve authenticated JSON stdin', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "office hook's %literal% & $name-"));
  const received: unknown[] = [];
  const response = { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'Café — कार्य' } };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200).end(JSON.stringify(response));
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const command = codexHookCommand(writeCodexHook(dir), 'Stop');
    for (const shell of ['cmd', 'powershell']) {
      const child = spawn(shell === 'cmd' ? process.env.COMSPEC || 'cmd.exe' : 'powershell.exe',
        shell === 'cmd' ? ['/d', '/s', '/c', `"${command}"`] : ['-NoProfile', '-NonInteractive', '-Command', command], {
          windowsVerbatimArguments: shell === 'cmd', windowsHide: true,
          env: { ...process.env, AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`, AGENT_OFFICE_HOOK_TOKEN: 'windows-test-token', AGENT_OFFICE_WORKER_ID: 'windows-worker' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      const ended = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      child.stdin.end(JSON.stringify({ session_id: 'windows-session-é', turn_id: 'windows-turn' }));
      assert.equal(await ended, 0, error);
      assert.deepEqual(JSON.parse(output), response);
    }
    assert.equal(received.length, 2);
    for (const event of received) assert.deepEqual(event, { authorization: 'Bearer windows-test-token', body: { session_id: 'windows-session-é', hook_event_name: 'Stop', turn_id: 'windows-turn' } });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker\'s own model and effort go on Codex\'s command line, in place of an office-wide model', () => {
  assert.deepEqual(codexModelArgs([]), []);
  assert.deepEqual(codexModelArgs(['--yolo'], 'gpt-5.5', 'high'), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  // Codex refuses --model twice: the office's --agent-args one gives way, however it was written.
  assert.deepEqual(codexModelArgs(['-m', 'gpt-6-astra', '--yolo'], 'gpt-5.5'), ['--yolo', '--model', 'gpt-5.5']);
  assert.deepEqual(codexModelArgs(['--model', 'gpt-6-astra'], 'gpt-5.5'), ['--model', 'gpt-5.5']);
  assert.deepEqual(codexModelArgs(['--model=gpt-6-astra', '-mgpt-6-astra', '--yolo'], 'gpt-5.5'), ['--yolo', '--model', 'gpt-5.5']);
  // With only an effort picked, the office-wide model stays.
  assert.deepEqual(codexModelArgs(['-m', 'gpt-6-astra'], undefined, 'xhigh'), ['-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="xhigh"']);
});

test('Codex planning seats preapprove only their role tools and promotion removes the overrides', () => {
  const launch = (role: 'candidate' | 'reviewer', locked: boolean, resumeSessionId?: string) =>
    codex.launch({ h: { info: { planReview: { id: 'p1', role, locked } }, state: codex.createState!() } as never, args: [], setup: { hook: '/data/hook.cjs', mcpScript: '/data/office-workers.js' }, resumeSessionId }).args;
  for (const role of ['candidate', 'reviewer'] as const) {
    const tools = ['plan_review_state', ...(role === 'candidate' ? ['submit_candidate_plan'] : ['request_plan_clarification', 'submit_plan_review'])];
    for (const session of [undefined, 'existing-session']) {
      const args = launch(role, true, session);
      assert.ok(args.includes('read-only'));
      assert.ok(args.includes('never'));
      assert.ok(args.some(a => a.includes('env_vars=') && a.includes('AGENT_OFFICE_PLAN_ROLE')));
      assert.ok(args.includes(`mcp_servers.agent-office.enabled_tools=${JSON.stringify(tools)}`));
      assert.deepEqual(args.filter(a => a.includes('.approval_mode=')), tools.map(t => `mcp_servers.agent-office.tools.${t}.approval_mode="approve"`));
    }
    const promoted = launch(role, false);
    assert.equal(promoted.some(a => /approval_mode|enabled_tools|AGENT_OFFICE_PLAN_ROLE/.test(a)), false);
    assert.equal(promoted.includes('read-only'), false);
  }
});

test('a Codex worker starts, and resumes, on the model and effort picked for it', () => {
  const launch = (info: { model?: string; effort?: string }, more: { prompt?: string; resumeSessionId?: string } = {}) =>
    codex.launch({ h: { info, state: codex.createState!() } as never, args: ['--yolo'], setup: { hook: '/data/hook.cjs' }, ...more }).args;
  const fresh = launch({ model: 'gpt-5.5', effort: 'high' }, { prompt: 'fix it' });
  assert.deepEqual(fresh.slice(0, 5), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  assert.deepEqual(fresh.slice(-2), ['--', 'fix it']);
  // Its options come before the `resume` subcommand, which then takes the session.
  const resumed = launch({ model: 'gpt-5.5', effort: 'high' }, { resumeSessionId: 'thread-1' });
  assert.deepEqual(resumed.slice(0, 5), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  assert.deepEqual(resumed.slice(-2), ['resume', 'thread-1']);
  // Left on its defaults, nothing is added.
  const plain = launch({});
  assert.equal(plain.includes('--model'), false);
  assert.equal(plain.some((a) => a.startsWith('model_reasoning_effort')), false);
});

test('writes a mode-restricted helper that forwards paths without reading transcripts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-codex-'));
  try {
    const file = writeCodexHook(dir);
    assert.equal(file, path.join(dir, 'agent-office-codex-hook.cjs'));
    const source = readFileSync(file, 'utf8');
    assert.match(source, /MAX = 64 \* 1024/);
    assert.match(source, /AGENT_OFFICE_HOOK_TOKEN/);
    assert.doesNotMatch(source, /readFile|readSync|createReadStream/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helper forwards only the bounded root event fields to the authenticated bridge', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-codex-'));
  const received: { url?: string; authorization?: string; body?: unknown } = {};
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.url = req.url;
      received.authorization = req.headers.authorization;
      received.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Office inbox: check now during this task' } }));
    });
  });
  try {
    const file = writeCodexHook(dir);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const child = spawn(process.execPath, [file, 'UserPromptSubmit'], {
      env: {
        PATH: process.env.PATH,
        AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`,
        AGENT_OFFICE_HOOK_TOKEN: 'hook-token',
        AGENT_OFFICE_WORKER_ID: 'worker-1',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const stdout = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', () => resolve(output));
      child.stdin.end(JSON.stringify({
        session_id: 'thread-1', prompt: 'fix it', turn_id: 'turn-1',
        transcript_path: '/private/transcript.jsonl', model: 'private-model',
        tool_input: { command: 'private' }, hook_event_name: 'forged',
      }));
    });
    assert.deepEqual(JSON.parse(stdout), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Office inbox: check now during this task' } });
    assert.equal(received.authorization, 'Bearer hook-token');
    assert.equal(received.url, '/hooks/codex?worker=worker-1&event=UserPromptSubmit');
    assert.deepEqual(received.body, {
      session_id: 'thread-1', hook_event_name: 'UserPromptSubmit', prompt: 'fix it', turn_id: 'turn-1',
      transcript_path: '/private/transcript.jsonl',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});


test('Codex input alerts require visible onboarding, never a missing startup hook', () => {
  assert.equal(codex.bootHint, undefined);
  assert.equal(codexBlocked('OpenAI Codex (v0.160.1)\nPull up a prompt.\n› Ask Codex to do anything'), undefined);
  assert.equal(codexBlocked('Working for 30s\nReading repository files'), undefined);
  assert.match(codexBlocked('Do you trust the contents of this directory?\n1. Yes\n2. No') ?? '', /trust prompt/);
  assert.match(codexBlocked('Welcome to Codex\n1. Sign in with ChatGPT\n2. Provide your own API key') ?? '', /sign-in/);
  assert.equal(codexBlocked('Welcome to Codex\nSign in with ChatGPT\n› Ask Codex to do anything'), undefined);
  assert.equal(codexBlocked('The documentation mentions API key and Sign in with ChatGPT.'), undefined);
});
