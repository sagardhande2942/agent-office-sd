import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefError, formatBrief, TASK_BRIEF_MAX, type TaskBrief } from '../src/shared/task-brief.js';

const brief = (patch: Partial<TaskBrief> = {}): TaskBrief => ({
  original: 'Fix offline floor deletion', goal: 'Delete removes the floor immediately',
  examples: '', constraints: 'Keep the checkout', acceptance: 'An offline floor disappears after Delete',
  assumptions: '', questions: '', ...patch,
});

test('brief preserves the request and labels unspecified details without inventing requirements', () => {
  const result = formatBrief(brief({ original: '  Line one\nLine two  ', assumptions: 'The viewer is an admin' }));
  assert.ok(result.includes('## Original request\nLine one\nLine two'));
  assert.ok(result.includes('## Examples\nNot specified.'));
  assert.ok(result.includes('## Assumptions (confirm before relying on them)\nThe viewer is an admin'));
  assert.ok(result.includes('## Constraints\nKeep the checkout'));
  assert.equal(briefError(brief()), undefined);
});

test('brief requires a request, goal and observable acceptance criteria', () => {
  assert.match(briefError(brief({ original: ' ' }))!, /rough request/);
  assert.match(briefError(brief({ goal: ' ' }))!, /goal/);
  assert.match(briefError(brief({ acceptance: '\n ' }))!, /acceptance criterion/);
});

test('brief refuses prompts above the worker limit, including section headings', () => {
  assert.match(briefError(brief({ examples: 'x'.repeat(TASK_BRIEF_MAX) }))!, /20,000/);
  const base = brief(), overhead = formatBrief(base).length;
  const exact = brief({ goal: base.goal + 'x'.repeat(TASK_BRIEF_MAX - overhead) });
  assert.equal(formatBrief(exact).length, TASK_BRIEF_MAX);
  assert.equal(briefError(exact), undefined);
  assert.match(briefError({ ...exact, goal: exact.goal + 'x' })!, /20,000/);
  assert.match(briefError(exact, TASK_BRIEF_MAX - 1000)!, /19,000/);
});
