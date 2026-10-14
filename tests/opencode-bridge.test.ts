// The plugin the office writes for its OpenCode-family workers, and the hook object and event
// stream it turns into worker statuses. OpenCode 1 and Kilo call `server()`; OpenCode 2 calls
// `setup(ctx)`. Both are exercised with representative events so a provider downgrade or a change
// to the generated module shows up here instead of as a desk stuck on "ready".
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeOpenCodeConfigContent, openCodePluginDir, openCodePluginSpecifier, writeOpenCodePlugin } from '../src/server/opencode.js';
import { opencode } from '../src/server/providers/opencode.js';
import { kilo } from '../src/server/providers/kilo.js';

const ENV_KEYS = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_HOOK_TOKEN', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_SESSION_ID', 'AGENT_OFFICE_EFFORT', 'AGENT_OFFICE_MODEL', 'AGENT_OFFICE_PLAN_ROLE'] as const;

type Payload = { type: string; sessionId?: string; status?: string; detail?: string; prompt?: string; tool?: string; usage?: unknown };

/** A bridge fixture: the generated module, its posts, and the environment it reads. */
function bridge(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-opencode-bridge-'));
  const entry = writeOpenCodePlugin(dir);
  const previous = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  const oldFetch = globalThis.fetch;
  const sent: Payload[] = [];
  Object.assign(process.env, { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_HOOK_TOKEN: 'token', AGENT_OFFICE_WORKER_ID: 'worker', AGENT_OFFICE_SESSION_ID: '' });
  delete process.env.AGENT_OFFICE_EFFORT;
  delete process.env.AGENT_OFFICE_MODEL;
  delete process.env.AGENT_OFFICE_PLAN_ROLE;
  globalThis.fetch = (async (_url: unknown, init?: unknown) => {
    sent.push(JSON.parse(String((init as { body?: string })?.body)) as Payload);
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    entry,
    sent,
    load: async () => await import(`${pathToFileURL(entry).href}?t=${Date.now()}-${Math.random()}`) as { default: { id: string; server: (input?: unknown) => Promise<any>; setup: (ctx: unknown) => Promise<unknown> } },
    last: () => sent.at(-1),
    flush: () => new Promise((resolve) => setTimeout(resolve, 25)),
  };
}

test('the office writes one plugin definition both OpenCode APIs accept, as a package directory', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-opencode-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = writeOpenCodePlugin(dir);
  // OpenCode 2 rejects a module file: its configured plugin must be a directory with a manifest.
  assert.ok(entry.endsWith(path.join('agent-office-opencode', 'index.mjs')), entry);
  const manifest = JSON.parse(readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'agent-office-opencode');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, 'index.mjs');
  assert.equal(openCodePluginSpecifier(entry), pathToFileURL(entry).href);
  assert.equal(openCodePluginDir(entry), pathToFileURL(path.dirname(entry)).href);
  assert.ok(existsSync(entry));

  // Kilo needs `server()`; OpenCode 2 needs `id` and `setup()`. A plugin exporting only a function
  // (the old shape) fails to load on both, which is what left those desks "ready" forever.
  const mod = await import(`${pathToFileURL(entry).href}?shape=${Date.now()}`);
  assert.equal(typeof mod.default, 'object');
  assert.equal(typeof mod.default.id, 'string');
  assert.equal(typeof mod.default.server, 'function');
  assert.equal(typeof mod.default.setup, 'function');
});

test('OpenCode 1 and Kilo report a whole turn through the hook object server() returns', async (t) => {
  const b = bridge(t);
  const mod = await b.load();
  const hooks = await mod.default.server({});
  assert.deepEqual(Object.keys(hooks).sort(), ['chat.message', 'event', 'tool.execute.after', 'tool.execute.before']);
  const event = (type: string, properties: Record<string, unknown> = {}) => hooks.event({ event: { type, properties } });

  // A session starts, then the worker is given the task: active work.
  await event('session.created', { info: { id: 'ses-root' } });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-root', status: 'starting' });
  await hooks['chat.message']({ sessionID: 'ses-root' }, { parts: [{ type: 'text', text: 'fix the login' }] });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'prompt', sessionId: 'ses-root', status: 'working', prompt: 'fix the login' });

  // A tool call, a subagent's session (ignored), and a permission prompt: waiting for the person.
  await hooks['tool.execute.before']({ sessionID: 'ses-root', tool: 'bash' });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'tool', sessionId: 'ses-root', tool: 'bash', status: 'working' });
  await event('session.created', { info: { id: 'ses-child', parentID: 'ses-root' } });
  await event('session.status', { sessionID: 'ses-child', status: { type: 'busy' } });
  await event('session.status', { sessionID: 'ses-nobody', status: { type: 'busy' } });
  await b.flush();
  assert.equal(b.last()?.sessionId, 'ses-root', 'an unrelated or subagent session never overwrites the desk');
  await event('permission.asked', { sessionID: 'ses-root', id: 'per-1', title: 'bash: rm -rf build' });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'permission', sessionId: 'ses-root', status: 'needs_input', detail: 'bash: rm -rf build' });
  await event('permission.replied', { sessionID: 'ses-root', requestID: 'per-1' });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-root', status: 'working' });

  // The turn ends, and an error keeps the desk actionable rather than only "done".
  await event('session.idle', { sessionID: 'ses-root' });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-root', status: 'done' });
  await hooks['chat.message']({ sessionID: 'ses-root' }, { parts: [{ type: 'text', text: 'retry it' }] });
  await event('session.error', { sessionID: 'ses-root', error: { message: 'provider unavailable' } });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'error', sessionId: 'ses-root', status: 'needs_input', detail: 'provider unavailable' });
});

/** A stand-in for the plugin context OpenCode 2 hands `setup()`: an event stream and the hooks it offers. */
function openCode2Context(options: { hooks?: boolean } = {}) {
  const hooks: Record<string, (event: any) => unknown> = {};
  const queued: unknown[] = [];
  const controller = new AbortController();
  const register = (prefix: string) => async (name: string, fn: (event: any) => unknown) => {
    if (options.hooks === false) throw new Error('this build offers no hooks');
    hooks[prefix + name] = fn;
    return { dispose: async () => {} };
  };
  const ctx = {
    event: {
      subscribe({ signal }: { signal: AbortSignal }) {
        return {
          async *[Symbol.asyncIterator]() {
            let i = 0;
            while (!signal.aborted) {
              if (i < queued.length) { yield queued[i++]; continue; }
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          },
        };
      },
    },
    session: { hook: register('session.') },
    tool: { hook: register('tool.') },
  };
  return { ctx, hooks, queued, controller };
}

test('OpenCode 2 reports a whole turn through setup() and its event stream', async (t) => {
  const b = bridge(t);
  const mod = await b.load();
  const { ctx, hooks, queued, controller } = openCode2Context();
  const cleanup = await mod.default.setup(ctx) as () => void;
  t.after(() => { controller.abort(); cleanup?.(); });
  assert.deepEqual(Object.keys(hooks).sort(), ['session.prompt', 'tool.execute.after', 'tool.execute.before']);
  const push = async (event: unknown) => { queued.push(event); await b.flush(); };

  // The user prompt claims the worker's root session and shows as the activity (a fresh worker).
  await hooks['session.prompt']({ sessionID: 'ses-root', messageID: 'm1', prompt: { text: 'fix the login', files: [] }, delivery: 'steer' });
  await b.flush();
  assert.deepEqual(b.sent.at(-2), { type: 'session', sessionId: 'ses-root', status: 'starting' });
  assert.deepEqual(b.last(), { type: 'prompt', sessionId: 'ses-root', status: 'working', prompt: 'fix the login' });

  // A subagent's session, and one the worker never claimed, are both ignored.
  await push({ type: 'session.execution.started', data: { sessionID: 'ses-child' } });
  await push({ type: 'session.execution.succeeded', data: { sessionID: 'ses-child' } });
  assert.equal(b.last()?.sessionId, 'ses-root');

  // Active work and a tool call.
  await push({ type: 'session.execution.started', data: { sessionID: 'ses-root' } });
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-root', status: 'working' });
  await hooks['tool.execute.before']({ tool: 'shell', sessionID: 'ses-root', id: 't1', input: {} });
  await b.flush();
  assert.deepEqual(b.last(), { type: 'tool', sessionId: 'ses-root', tool: 'shell', status: 'working' });

  // Waiting for approval, and its answer.
  await push({ type: 'permission.asked', data: { id: 'per-1', sessionID: 'ses-root', action: 'shell', resources: ['rm -rf build'] } });
  assert.deepEqual(b.last(), { type: 'permission', sessionId: 'ses-root', status: 'needs_input', detail: 'shell: rm -rf build' });
  await push({ type: 'permission.replied', data: { sessionID: 'ses-root', requestID: 'per-1', reply: 'once' } });
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-root', status: 'working' });

  // Its spend, and the end of the turn.
  await push({ type: 'session.usage.updated', data: { sessionID: 'ses-root', cost: 0.25, tokens: { input: 16, output: 9, reasoning: 3, cache: { read: 5, write: 2 } } } });
  assert.deepEqual(b.last(), { type: 'usage', sessionId: 'ses-root', usage: { input: 16, output: 9, reasoning: 3, cacheRead: 5, cacheWrite: 2, cost: 0.25, calls: 1, costKnown: true } });
  await push({ type: 'session.execution.succeeded', data: { sessionID: 'ses-root' } });
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-root', status: 'done' });
  cleanup();
});

test('OpenCode 2 resumes the session it was given, and reports a failed turn as actionable', async (t) => {
  const b = bridge(t);
  process.env.AGENT_OFFICE_SESSION_ID = 'ses-resumed';
  const mod = await b.load();
  const { ctx, hooks, queued } = openCode2Context();
  const cleanup = await mod.default.setup(ctx) as () => void;
  t.after(() => cleanup?.());
  const push = async (event: unknown) => { queued.push(event); await b.flush(); };

  // A resumed worker already knows its session: its first event is the work itself.
  await push({ type: 'session.execution.started', data: { sessionID: 'ses-resumed' } });
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-resumed', status: 'working' });
  await push({ type: 'session.execution.interrupted', data: { sessionID: 'ses-resumed' } });
  assert.deepEqual(b.last(), { type: 'session', sessionId: 'ses-resumed', status: 'done' });
  await push({ type: 'session.execution.failed', data: { sessionID: 'ses-resumed', error: { type: 'provider.error', message: 'upstream failed' } } });
  assert.deepEqual(b.last(), { type: 'error', sessionId: 'ses-resumed', status: 'needs_input', detail: 'upstream failed' });
  cleanup();
});

test('OpenCode 2 still reports a turn when the build offers no prompt hook', async (t) => {
  const b = bridge(t);
  const mod = await b.load();
  const { ctx, queued, controller } = openCode2Context({ hooks: false });
  const cleanup = await mod.default.setup(ctx) as () => void;
  t.after(() => { controller.abort(); cleanup?.(); });
  // With no hook to name the session, the worker's first session event still claims it.
  queued.push({ type: 'session.execution.started', data: { sessionID: 'ses-late' } });
  await b.flush();
  assert.deepEqual(b.sent.filter((event) => event.type === 'session'), [
    { type: 'session', sessionId: 'ses-late', status: 'starting' },
    { type: 'session', sessionId: 'ses-late', status: 'working' },
  ]);
  cleanup();
});

test('the OpenCode adapter hands each CLI generation the plugin shape and key it loads', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-opencode-launch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const version = (name: string, out: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\necho ${out}\n`, { mode: 0o700 });
    chmodSync(file, 0o700);
    return file;
  };
  const setup = opencode.prepare!({ dataDir: dir, dscProfile: 'acp' } as never) as { plugin: string };
  const launch = (command: string) => {
    const info: Record<string, unknown> = { id: 'worker', provider: 'opencode' };
    const plan = opencode.launch({ h: { info, state: opencode.createState!() } as never, command, args: [], setup });
    const env: Record<string, string> = {};
    plan.finishEnv?.(env);
    return JSON.parse(env.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>;
  };
  // OpenCode 2 loads a configured plugin from a package directory, under `plugins`.
  const v2 = launch(version('opencode2', '2.0.24'));
  assert.deepEqual(v2.plugins, [openCodePluginDir(setup.plugin)]);
  assert.equal(v2.plugin, undefined);
  // OpenCode 1 takes the entry module itself, under `plugin`.
  const v1 = launch(version('opencode1', '1.0.200'));
  assert.deepEqual(v1.plugin, [openCodePluginSpecifier(setup.plugin)]);
  assert.equal(v1.plugins, undefined);

  // Kilo (an OpenCode fork that calls server()) is written the entry module.
  const kiloSetup = kilo.prepare!({ dataDir: dir } as never) as { plugin: string };
  assert.equal(kiloSetup.plugin, openCodePluginSpecifier(setup.plugin));
  assert.equal(kilo.hooksAs, 'opencode');
});

test('inline OpenCode config keeps a plugin where the generation reads it, and rejects a malformed one', () => {
  assert.deepEqual(JSON.parse(mergeOpenCodeConfigContent(undefined, 'file:///p/index.mjs', undefined, 'plugin')), { plugin: ['file:///p/index.mjs'] });
  assert.deepEqual(JSON.parse(mergeOpenCodeConfigContent('{"plugins":["other"]}', 'file:///p', undefined, 'plugins')), { plugins: ['other', 'file:///p'] });
  assert.deepEqual(JSON.parse(mergeOpenCodeConfigContent('{"plugin":["a"]}', 'a', undefined, 'plugin')), { plugin: ['a'] }, 'an entry already there is not added twice');
  assert.throws(() => mergeOpenCodeConfigContent('{"plugin":"nope"}', 'x'), /OPENCODE_CONFIG_CONTENT/);
  assert.throws(() => mergeOpenCodeConfigContent('{broken', 'x'), /OPENCODE_CONFIG_CONTENT/);
});
