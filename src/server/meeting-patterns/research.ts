import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import type { Meeting } from '../../shared/protocol.js';
import { researchPattern } from '../../shared/research-patterns.js';
import type { PatternPart } from './types.js';

export function researchBrief(m: Meeting): string | undefined {
  const p = researchPattern(m.pattern);
  if (!p) return;
  return `${p.objective} Version ${p.version}. Stages: ${p.stages?.join(' → ')}. ` +
    'First-round assessments are independent by instruction only: peers share this worktree, so no blind-review security is claimed. ' +
    (m.pattern === 'research.strategy-build' ? 'Only seat 2 implements the strategy, only within the lead’s explicit write set during Implementation; the reviewer writes review notes only. ' : 'Write only your assigned notes; do not edit strategy code. ') +
    'Do not submit external jobs, run trading code, push, commit or switch branches from this meeting. ' +
    'Read supplied evidence and relevant Knowledge using existing authenticated tools when available; do not invent missing memory or results. ' +
    'No automatic backtest submission or pipeline routing is claimed by these patterns. ' +
    'A verdict is a research recommendation, not permission for live trading or proof of an accepted pipeline transition.';
}

export function researchPlan(m: Meeting, round: number, step: number, cwd: string): PatternPart[] | null {
  const p = researchPattern(m.pattern);
  if (!p || step !== 1 || round > p.rounds.max) return null;
  const note = (r: number, i: number) => `${m.notes}/research-r${r}-seat${i + 1}.md`;
  const all = m.seats.map((_, i) => i);
  const reports = (r: number) => all.map(i => path.join(cwd, note(r, i))).join(', ');
  if (m.pattern === 'research.strategy-build' && round < 4) {
    const seat = round === 1 ? 0 : round === 2 ? 1 : 2;
    const asks = [
      'Plan the strategy implementation against the supplied specification. Assign the sole implementer an explicit bounded file write set; other participants must not edit code. Identify required Runner callbacks and meaningful verification commands. Do not implement yet.',
      `Read ${path.join(cwd, note(1, 0))}. Implement only within that plan’s write set. Record exact changed files, source/config digests and meaningful check results; do not submit experiments, push, commit or change branches.`,
      `Read ${path.join(cwd, note(1, 0))} and ${path.join(cwd, note(2, 1))}. Independently inspect the actual code against the specification and callback contracts. Write only review notes, including unresolved correctness issues; never approve your own implementation.`,
    ];
    return [{ seat, doing: p.stages![round - 1], file: note(round, seat), ask: asks[round - 1] + ` Write your report to ${path.join(cwd, note(round, seat))}.` }];
  }
  if (m.pattern !== 'research.strategy-build' && round < 3) return all.map(i => ({ seat: i, doing: round === 1 ? 'independent assessment' : 'challenging assumptions',
    file: note(round, i), ask: (round === 1
      ? `As ${m.seats[i].role}, assess the agenda independently before reading peer notes. ${p.objective}`
      : `Read ${reports(1)}. Challenge unsupported claims, data leakage, costs, missing evidence and alternatives through your role. Preserve counterexamples and dissent.`) +
      ` Cite exact supplied revision/run/artifact references; write ${path.join(cwd, note(round, i))}. Write no other files. Do not fabricate evidence or execute experiments.` }));
  return [{ seat: 0, doing: 'synthesizing research recommendation', file: m.output,
    ask: `Read the round notes under ${path.join(cwd, m.notes)}. Preserve dissent; do not decide by majority vote alone. ` +
      `Write a JSON object to ${path.join(cwd, m.output)} with schema_version:1, meeting_id:${JSON.stringify(m.id)}, ` +
      `pattern:${JSON.stringify(m.pattern)}, pattern_version:1, summary (nonempty string), outcome (one of ${p.outcomes.join(', ')}), ` +
      'evidence_run_ids (array of distinct nonempty strings), findings and dissent (arrays of strings), next_action (nonempty string), ' +
      `and details (object containing ${p.required.join(', ')}). Every details value must be nonempty or a number, boolean, array or object; use explicit missing-input explanations instead of invented data. ` +
      'Test-analysis mode must be preflight or postrun. Validation advance/reject/revise, portfolio paper_review/reject, and postrun ready/revise need evidence_run_ids. ' +
      'Blocked/inconclusive results may lack evidence but must explain the gap. Also write a human-readable report to ' +
      `${path.join(cwd, m.output)}.md. Do not modify strategy code during synthesis or publish a PR. These outputs propose research actions only.` }];
}

function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

/** Structural checks only. The middleware must independently verify all cited research evidence. */
export function validateResearchResult(m: Meeting, value: unknown): string | undefined {
  const p = researchPattern(m.pattern);
  if (!p) return;
  const fail = (why: string) => `Invalid research result: ${why}; preserve notes and start a corrected session.`;
  if (m.patternVersion !== p.version) return fail('unsupported pattern version');
  if (!record(value) || value.schema_version !== 1 || value.meeting_id !== m.id || value.pattern !== m.pattern || value.pattern_version !== p.version)
    return fail('schema, meeting or pattern identity mismatch');
  if (!text(value.summary) || !text(value.next_action) || !text(value.outcome) || !p.outcomes.includes(value.outcome)) return fail('summary, outcome or next_action');
  if (!strings(value.findings) || !strings(value.dissent) || !strings(value.evidence_run_ids) || new Set(value.evidence_run_ids).size !== value.evidence_run_ids.length)
    return fail('findings, dissent or evidence IDs');
  const details = value.details;
  if (!record(details) || p.required.some(key => !Object.hasOwn(details, key) || details[key] == null || (typeof details[key] === 'string' && !text(details[key]))))
    return fail('missing pattern-specific details');
  if (m.pattern === 'research.test-analysis' && !['preflight', 'postrun'].includes(String(details.mode))) return fail('test-analysis mode');
  const needsEvidence = m.pattern === 'research.validation-council' && ['advance', 'reject', 'revise'].includes(value.outcome)
    || m.pattern === 'research.portfolio-review' && ['paper_review', 'reject'].includes(value.outcome)
    || m.pattern === 'research.test-analysis' && details.mode === 'postrun' && ['ready', 'revise'].includes(value.outcome);
  if (needsEvidence && !value.evidence_run_ids.length) return fail('decision needs cited run evidence');
}

export function validateResearchOutput(m: Meeting, cwd: string): string | undefined {
  if (!researchPattern(m.pattern)) return;
  try {
    const file = path.join(cwd, m.output);
    if (statSync(file).size > 256 * 1024) return 'Invalid research result: exceeds 256 KiB';
    const error = validateResearchResult(m, JSON.parse(readFileSync(file, 'utf8')));
    if (error) return error;
    const report = path.join(cwd, m.output + '.md');
    if (statSync(report).size > 256 * 1024 || !readFileSync(report, 'utf8').trim()) return 'Invalid research result: missing or oversized readable report';
  } catch { return 'Invalid research result: missing/unreadable JSON or readable report'; }
}
