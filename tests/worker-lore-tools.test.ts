import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
// @ts-expect-error The shipped CLI is plain JavaScript.
import { main, parseArgs, buildRequest, handleMcp } from '../bin/office-workers.js';

const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234', AGENT_OFFICE_WORKER_ID: 'ada', AGENT_OFFICE_HOOK_TOKEN: 'test-token' };
test('lore CLI and MCP share authenticated endpoints and encode the query as data', async () => {
  assert.deepEqual(parseArgs(['lore', 'list', '--json', '--query', 'auth&floor=elsewhere']), { cmd: 'lore.list', query: 'auth&floor=elsewhere' });
  const req = buildRequest('lore.list', { url: env.AGENT_OFFICE_HOOK_URL, worker: 'ada', token: 'test-token' }, { query: 'auth&floor=elsewhere' });
  assert.equal(req.method, 'GET'); assert.equal(new URL(req.url).searchParams.get('query'), 'auth&floor=elsewhere');
  assert.equal(new URL(req.url).searchParams.has('floor'), false);
  const calls: any[] = [], outputs: string[] = [];
  const fetchImpl = async (url: string, options: any) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ note: { id: 'knowledge-1' } })); };
  const draft = { title: 'Auth fixture', content: 'Verified setup', tags: ['auth'] };
  assert.equal(await main(['lore', 'save'], { env, stdin: Readable.from([JSON.stringify(draft)]), fetch: fetchImpl, out: (s: string) => outputs.push(s) }), 0);
  assert.equal(calls[0].method, 'POST'); assert.deepEqual(JSON.parse(calls[0].body), draft);
  assert.equal(calls[0].headers.authorization, 'Bearer test-token');
  const answer = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_worker_lore', arguments: draft } }, { env, fetch: fetchImpl });
  assert.equal(answer.result.isError, undefined); assert.deepEqual(JSON.parse(calls[1].body), draft);
  await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'worker_lore', arguments: { query: 'auth' } } }, { env, fetch: fetchImpl });
  assert.equal(calls[2].method, 'GET'); assert.equal(new URL(calls[2].url).searchParams.get('query'), 'auth');
});
