import test from 'node:test';
import assert from 'node:assert/strict';
import { requestKnowledgePlan } from '../src/server/knowledge/curator-plan.js';
const batch = ['a.md', 'b.md'].map(path => ({ path, frontmatter: { title: path, summary: path }, body: path, version: path }));
const overlap = { summary: 'Conflicting plan', actions: [
  { action: 'merge', path: 'a.md', target: 'b.md', reason: 'Combine' },
  { action: 'rewrite-summary', path: 'b.md', summary: 'Better summary', reason: 'Clarify' },
] };
const corrected = { summary: 'One merge', actions: [overlap.actions[0]] };
test('overlapping plans receive path-specific feedback and a validated replacement', async () => {
  const prompts: string[] = [];
  const result = await requestKnowledgePlan(async prompt => { prompts.push(prompt); return prompts.length === 1 ? overlap : corrected; }, batch, [], [], new AbortController().signal);
  assert.deepEqual(result, corrected); assert.equal(prompts.length, 2);
  assert.match(prompts[0], /merge targets and split destinations/);
  assert.match(prompts[1], /Overlapping curator actions: b.md/);
});
test('a second conflicting plan fails without further retries', async () => {
  let calls = 0;
  await assert.rejects(requestKnowledgePlan(async () => { calls++; return overlap; }, batch, [], [], new AbortController().signal), /Overlapping curator actions: b.md/);
  assert.equal(calls, 2);
});
test('out-of-batch actions fail immediately rather than being retried', async () => {
  let calls = 0;
  await assert.rejects(requestKnowledgePlan(async () => { calls++; return { summary: '', actions: [{ action: 'archive', path: 'outside.md', reason: 'Remove' }] }; }, batch, [], [], new AbortController().signal), /exact supplied path/);
  assert.equal(calls, 1);
});
test('cancellation prevents the correction request', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(requestKnowledgePlan(async () => { calls++; controller.abort(); return overlap; }, batch, [], [], controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('valid plans do not spend another agent call', async () => {
  let calls = 0;
  assert.deepEqual(await requestKnowledgePlan(async () => { calls++; return corrected; }, batch, [], [], new AbortController().signal), corrected);
  assert.equal(calls, 1);
});
