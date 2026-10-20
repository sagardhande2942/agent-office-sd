import test from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH_PATTERNS, researchPattern } from '../src/shared/research-patterns.js';
import { MEETING_PATTERNS, isMeetingPattern } from '../src/shared/meetings.js';
import type { Meeting } from '../src/shared/protocol.js';
import { planMeeting } from '../src/server/meeting-patterns/index.js';
import { validateResearchResult } from '../src/server/meeting-patterns/research.js';

function meeting(pattern: Meeting['pattern']): Meeting {
  const p = MEETING_PATTERNS[pattern];
  return { id: 'session-42', pattern, patternVersion: 1, output: 'research/result.json', notes: '.meeting/session-42',
    rounds: p.rounds.default, seats: p.roles.slice(0, p.seats.default).map(role => ({ role, deskId: 'chair' })) } as Meeting;
}
function result(m: Meeting) {
  const p = researchPattern(m.pattern)!;
  return { schema_version: 1, meeting_id: m.id, pattern: m.pattern, pattern_version: 1, summary: 'Review of supplied evidence',
    outcome: 'blocked', evidence_run_ids: [], findings: ['Missing inputs'], dissent: [], next_action: 'Supply identified artifacts',
    details: Object.fromEntries(p.required.map(key => [key, key === 'mode' ? 'preflight' : 'Unavailable: request input'])) };
}

test('all seven registered research patterns have executable bounded stages and validated outputs', () => {
  assert.equal(Object.keys(RESEARCH_PATTERNS).length, 7);
  for (const id of Object.keys(RESEARCH_PATTERNS) as (keyof typeof RESEARCH_PATTERNS)[]) {
    assert.ok(isMeetingPattern(id)); const m = meeting(id); const p = researchPattern(id)!;
    assert.equal(p.stages?.length, m.rounds);
    for (let round = 1; round <= m.rounds; round++) {
      const parts = planMeeting(m, round, 1, '/fixture', () => { throw Error('research must use its registered planner'); });
      assert.ok(parts?.length); assert.ok(parts.every(part => part.seat < m.seats.length));
      assert.equal(planMeeting(m, round, 2, '/fixture', () => ''), null);
    }
    assert.equal(validateResearchResult(m, result(m)), undefined, id);
    assert.equal(planMeeting(m, m.rounds + 1, 1, '/fixture', () => ''), null);
  }
  assert.equal(researchPattern('constructor'), undefined);
});

test('engineering gives only one implementer the code-writing round before independent review', () => {
  const m = meeting('research.strategy-build');
  const turns = [1, 2, 3, 4].map(round => planMeeting(m, round, 1, '/fixture', () => '')!);
  assert.deepEqual(turns.map(parts => parts.map(p => p.seat)), [[0], [1], [2], [0]]);
  assert.match(turns[1][0].ask, /write set/); assert.match(turns[2][0].ask, /actual code/);
});

test('identity, schema, field types, evidence and pattern-specific requirements cannot be bypassed', () => {
  const m = meeting('research.validation-council'); const good = result(m);
  for (const mutation of [null, [], {}, { meeting_id: 'other' }, { pattern_version: 2 }, { outcome: 'accept' },
    { findings: [null] }, { dissent: 'none' }, { evidence_run_ids: ['r', 'r'] }, { details: {} }, { summary: ' ' }]) {
    const v = mutation === null || Array.isArray(mutation) ? mutation : { ...good, ...mutation };
    if (mutation && !Array.isArray(mutation) && !Object.keys(mutation).length) continue;
    assert.match(validateResearchResult(m, v)!, /Invalid research result/);
  }
  assert.match(validateResearchResult(m, { ...good, outcome: 'advance' })!, /evidence/);
  assert.equal(validateResearchResult(m, { ...good, outcome: 'advance', evidence_run_ids: ['run-1'] }), undefined);
  assert.match(validateResearchResult({ ...m, patternVersion: 2 }, good)!, /version/);
  const qa = meeting('research.test-analysis');
  const q = result(qa); q.details.mode = 'postrun';
  assert.match(validateResearchResult(qa, { ...q, outcome: 'ready' })!, /evidence/);
  q.details.mode = 'unknown'; assert.match(validateResearchResult(qa, q)!, /mode/);
});
