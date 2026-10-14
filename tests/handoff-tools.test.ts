import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
// @ts-expect-error The shipped CLI is plain JavaScript.
import { HANDOFF_TOOL_EXTENSION, readCreatePacket } from '../bin/office-handoff-tools.js';
// @ts-expect-error The shipped CLI is plain JavaScript.
import { MCP_READ_ONLY, TOOLS, buildRequest, handleMcp, main, parseArgs } from '../bin/office-workers.js';

const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234', AGENT_OFFICE_WORKER_ID: 'ada', AGENT_OFFICE_HOOK_TOKEN: 'test-token' };
const office = { url: env.AGENT_OFFICE_HOOK_URL, worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };

const packet = {
  key: 'key-1', recipient: 'bit', revision: 7, completedWork: 'Persisted the store',
  nextSteps: 'Wire the route', questions: ['Should cancel stay visible?'],
};

test('handoff CLI parsing: one action per verb, an id where one is needed, JSON only for create', () => {
  assert.deepEqual(parseArgs(['handoff', 'list', '--json']), { cmd: 'handoff.list', args: {} });
  assert.deepEqual(parseArgs(['handoff']), { cmd: 'handoff.list', args: {} });
  assert.deepEqual(parseArgs(['handoff', 'prefill']), { cmd: 'handoff.prefill', args: {} });
  assert.deepEqual(parseArgs(['handoff', 'read', 'h-1']), { cmd: 'handoff.read', args: { id: 'h-1' } });
  assert.deepEqual(parseArgs(['handoff', 'accept', 'h-2']), { cmd: 'handoff.accept', args: { id: 'h-2' } });
  assert.deepEqual(parseArgs(['handoff', 'cancel', 'h-3']), { cmd: 'handoff.cancel', args: { id: 'h-3' } });
  assert.deepEqual(parseArgs(['handoff', 'create']), { cmd: 'handoff.create', args: {} });
  assert.deepEqual(parseArgs(['handoff', 'create', '--json']), { cmd: 'handoff.create', args: {} });
  assert.throws(() => parseArgs(['handoff', 'delete', 'h-1']), /Unknown handoff action/);
  assert.throws(() => parseArgs(['handoff', 'read']), /takes one handoff id/);
  assert.throws(() => parseArgs(['handoff', 'accept', 'h-1', 'h-2']), /takes one handoff id/);
  assert.throws(() => parseArgs(['handoff', 'list', 'extra']), /takes no arguments/);
  assert.throws(() => parseArgs(['handoff', 'create', '--key', 'k1']), /Submit the packet JSON on stdin/);
  assert.throws(() => parseArgs(['handoff', 'list', '--floor', 'elsewhere']), /Unknown handoff option/);
});

test('handoff create validates the packet schema before anything leaves the terminal', () => {
  // The minimum honest packet: an explicit empty questions list carries its note.
  const minimal = { ...packet, questions: [], questionsNote: 'none: the checks all pass' };
  assert.deepEqual(readCreatePacket(minimal), minimal, 'a valid packet passes through with only its own fields');
  // files omitted means "prefill from my completion"; it never becomes an implicit empty list.
  assert.equal('files' in readCreatePacket(minimal), false);
  assert.deepEqual(readCreatePacket({ ...packet, files: ['src/server/handoff/store.ts'] }).files, ['src/server/handoff/store.ts']);
  // An explicit empty files list must explain itself.
  const noFiles = readCreatePacket({ ...packet, files: [], filesNote: 'no commits yet: everything stays uncommitted in the source worktree' });
  assert.deepEqual(noFiles.files, []); assert.equal(noFiles.filesNote, 'no commits yet: everything stays uncommitted in the source worktree');
  assert.throws(() => readCreatePacket({ ...packet, files: [] }), /files is empty: add filesNote/);
  assert.throws(() => readCreatePacket({ ...packet, questions: [] }), /questions is empty: add questionsNote/);
  assert.throws(() => readCreatePacket({ ...minimal, questions: undefined }), /questions is required/);
  assert.throws(() => readCreatePacket({ ...packet, key: '' }), /key \(your idempotency key/);
  assert.throws(() => readCreatePacket({ ...packet, recipient: '  ' }), /recipient/);
  assert.throws(() => readCreatePacket({ ...packet, revision: '7' }), /revision must be your current completion revision/);
  assert.throws(() => readCreatePacket({ ...packet, revision: -1 }), /revision must be your current completion revision/);
  assert.throws(() => readCreatePacket({ ...packet, completedWork: '' }), /completedWork/);
  assert.throws(() => readCreatePacket({ ...packet, nextSteps: '' }), /nextSteps/);
  assert.throws(() => readCreatePacket({ ...packet, checks: [{ name: 'typecheck', status: 'green', evidence: 'ok' }] }), /status must be passed, failed or skipped/);
  assert.throws(() => readCreatePacket({ ...packet, checks: [{ name: 'typecheck', status: 'passed' }] }), /evidence/);
  assert.throws(() => readCreatePacket({ ...packet, checks: [{ name: 'typecheck', status: 'passed', evidence: '   ' }] }), /evidence/);
  // An empty checks list is not "nothing to report": one skipped check carries the reason.
  assert.throws(() => readCreatePacket({ ...packet, checks: [] }), /checks must be 1-30 checks/);
  assert.deepEqual(readCreatePacket({ ...packet, checks: [{ name: 'typecheck', status: 'failed', evidence: 'npm run typecheck: 2 errors in store.ts' }] }).checks,
    [{ name: 'typecheck', status: 'failed', evidence: 'npm run typecheck: 2 errors in store.ts' }]);
  // A skipped check still carries its reason, so the recipient can judge what was not verified.
  assert.deepEqual(readCreatePacket({ ...packet, checks: [{ name: 'build', status: 'skipped', evidence: 'CLI-only change: no client bundle affected' }] }).checks,
    [{ name: 'build', status: 'skipped', evidence: 'CLI-only change: no client bundle affected' }]);
  assert.throws(() => readCreatePacket({ ...packet, context: { brnach: 'office/ada' } }), /context has unknown field/);
  assert.deepEqual(readCreatePacket({ ...packet, context: {} }).context, undefined, 'an empty context is no context');
  assert.deepEqual(readCreatePacket({ ...packet, context: { branch: 'office/ada', commit: 'abc1234' } }).context, { branch: 'office/ada', commit: 'abc1234' });
  assert.throws(() => readCreatePacket({ ...packet, context: { commit: 'not-a-hash' } }), /context.commit must be a git hash/);
  assert.throws(() => readCreatePacket({ ...packet, context: { pr: 'PR #42' } }), /context.pr must be an http\(s\) URL/);
  assert.throws(() => readCreatePacket({ ...packet, revsion: 7 }), /unknown field\(s\): revsion/);
  assert.throws(() => readCreatePacket(null), /submit a JSON object/);
});

test('every handoff action is one authenticated POST to /office/workers/handoff with the action in the body', () => {
  for (const action of ['list', 'read', 'prefill', 'create', 'accept', 'cancel']) {
    const req = buildRequest(`handoff.${action}`, office, { action });
    assert.equal(req.method, 'POST', `${action} posts`);
    const url = new URL(req.url);
    assert.equal(url.pathname, '/office/workers/handoff');
    assert.equal(url.searchParams.get('worker'), 'ada', 'the office authenticates the caller; identity is never in the body');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    assert.equal(JSON.parse(req.body!).action, action);
  }
});

test('MCP exposes exactly the six handoff tools; only list/read/prefill are read-only', () => {
  const names = TOOLS.filter((t: any) => t.name.startsWith('handoff_')).map((t: any) => t.name);
  assert.deepEqual(names, ['handoff_list', 'handoff_read', 'handoff_prefill', 'handoff_create', 'handoff_accept', 'handoff_cancel']);
  assert.deepEqual(names.filter((n: string) => MCP_READ_ONLY.includes(n)), ['handoff_list', 'handoff_read', 'handoff_prefill']);
  const create: any = TOOLS.find((t: any) => t.name === 'handoff_create');
  assert.deepEqual(create.inputSchema.required, ['key', 'recipient', 'revision', 'completedWork', 'nextSteps', 'questions']);
  assert.equal(create.inputSchema.additionalProperties, false);
  assert.deepEqual(create.inputSchema.properties.checks.items.properties.status.enum, ['passed', 'failed', 'skipped']);
});

test('handoff CLI and MCP send the same bodies, and create/accept/cancel validate before calling', async () => {
  const calls: any[] = [];
  const fetchImpl = async (url: string, options: any) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ handoff: { id: 'h-1', state: 'offered' } })); };
  const outputs: string[] = [];
  // create reads its packet on stdin and adds the action; accept sends only the packet id.
  assert.equal(await main(['handoff', 'create'], { env, stdin: Readable.from([JSON.stringify(packet)]), fetch: fetchImpl, out: (s: string) => outputs.push(s) }), 0);
  assert.deepEqual(JSON.parse(calls[0].body), { ...packet, action: 'create' });
  assert.equal(calls[0].headers.authorization, 'Bearer test-token');
  assert.equal(await main(['handoff', 'accept', 'h-1'], { env, stdin: Readable.from([]), fetch: fetchImpl, out: (s: string) => outputs.push(s) }), 0);
  assert.deepEqual(JSON.parse(calls[1].body), { id: 'h-1', action: 'accept' }, 'explicit acceptance carries the id; the recipient is the authenticated caller');
  assert.deepEqual(JSON.parse(outputs[1]), { handoff: { id: 'h-1', state: 'offered' } });
  // The MCP tools route through the same endpoint with the same validation.
  await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'handoff_create', arguments: packet } }, { env, fetch: fetchImpl });
  assert.deepEqual(JSON.parse(calls[2].body), { ...packet, action: 'create' });
  await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'handoff_list', arguments: {} } }, { env, fetch: fetchImpl });
  assert.deepEqual(JSON.parse(calls[3].body), { action: 'list' });
  // A malformed packet fails fast, with the schema's own words, before any request.
  const bad = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'handoff_create', arguments: { ...packet, questions: [] } as any } }, { env, fetch: fetchImpl });
  assert.equal((bad.result as any).isError, true);
  assert.match((bad.result as any).content[0].text, /questions/);
  const noId = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'handoff_accept', arguments: {} } }, { env, fetch: fetchImpl });
  assert.equal((noId.result as any).isError, true);
  assert.match((noId.result as any).content[0].text, /id must be the id of a handoff packet/);
  assert.equal(calls.length, 4, 'validation failures make no request');
  // A bad stdin packet rejects with the schema's words and sends nothing. (Extension run errors
  // reject main, as the other bin extensions do; parsing errors are caught by main and show help.)
  await assert.rejects(() => main(['handoff', 'create'], { env, stdin: Readable.from(['{not json']), fetch: fetchImpl, out: () => {} }), /requires valid JSON on stdin/);
  assert.equal(calls.length, 4);
});

test('the help names the handoff command and the create schema it reads on stdin', async () => {
  assert.match(HANDOFF_TOOL_EXTENSION.usage, /office-workers handoff create < packet\.json/);
  assert.match(HANDOFF_TOOL_EXTENSION.usage, /key, recipient, revision, completedWork/);
  assert.match(HANDOFF_TOOL_EXTENSION.usage, /nextSteps, questions/);
  const outputs: string[] = [];
  assert.equal(await main(['handoff', '--help'], { env, out: (s: string) => outputs.push(s) }), 0);
  assert.match(outputs.join('\n'), /office-workers handoff accept <id>/);
});
