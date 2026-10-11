import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchStore } from '../src/server/trading-research/coordinator/store.js';
import { ResearchScheduler } from '../src/server/trading-research/coordinator/scheduler.js';
import type { DiscoveryAdapter } from '../src/server/trading-research/coordinator/adapter.js';
import { parseEvaluation } from '../src/server/trading-research/coordinator/adapter.js';
import { researchBrief, type ResearchBrief, type ResearchState } from '../src/shared/trading-research.js';
import { coordinatorUrl, publicResearch } from '../src/server/trading-research/link.js';

const brief: ResearchBrief = { objective: 'Investigate an independently testable hypothesis', constraints: 'Development data only', symbols: ['EURUSD'], timeframe: 'M1', start: '20230101', end: '20240101', dataset: 'fixture-v1', maxExperiments: 3, maxWorkers: 2, timeoutMinutes: 1, walkForward: false };
const code = 'class Strategy: pass', config = JSON.stringify({ config: { account_id: 'test' }, RMS: {} });
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'research-test-')); return { dir, store: new ResearchStore(dir), close: () => rmSync(dir, { recursive: true, force: true }) }; }
function campaign(store: ResearchStore, b = brief) { return store.action('floor-a', { action: 'create', brief: b, requestId: 'create-1' }); }
function submit(store: ResearchStore) {
  const state = campaign(store), assignment = state.assignments[0].id;
  const assigned = store.action('floor-a', { action: 'assign', assignment, worker: 'researcher' }).assignments[0];
  const body = { action: 'submit' as const, assignment, worker: 'researcher', lease: assigned.lease!, hypothesis: 'Recorded hypothesis', code, config };
  return { body, state: store.action('floor-a', body) };
}
test('campaigns and submissions survive restart, scope isolation, idempotent requests and immutable artifacts', () => {
  const f = fixture(); try {
    const { body, state } = submit(f.store), e = state.experiments[0];
    f.store.action('floor-a', body); campaign(f.store);
    const restored = new ResearchStore(f.dir);
    assert.equal(restored.state('floor-a').campaigns.length, 1); assert.equal(restored.state('floor-a').experiments.length, 1);
    assert.equal(restored.state('floor-b').experiments.length, 0);
    assert.equal(readFileSync(restored.artifact(e.id, 'strategy.py'), 'utf8'), code);
    assert.match(e.hash, /^[a-f0-9]{64}$/);
    assert.throws(() => restored.action('floor-b', body), /No such assignment/);
    assert.throws(() => restored.action('floor-a', { ...body, code: code + '\n# changed' }), /different strategy/);
    assert.ok(!publicResearch(restored.state('floor-a')).assignments[0].lease);
  } finally { f.close(); }
});
test('leases reject stale results; paused campaigns retain drafts and enforce worker/hypothesis budgets', () => {
  const f = fixture(); try {
    const state = campaign(f.store, { ...brief, maxWorkers: 1, maxExperiments: 2 }), c = state.campaigns[0].id, a = state.assignments[0].id;
    const lease = f.store.action('floor-a', { action: 'assign', assignment: a, worker: 'r1' }).assignments[0].lease!;
    f.store.action('floor-a', { action: 'add', campaign: c, instructions: 'Distinct hypothesis', requestId: 'add-1' });
    const second = f.store.state('floor-a').assignments[1].id;
    assert.throws(() => f.store.action('floor-a', { action: 'assign', assignment: second, worker: 'r2' }), /worker limit/);
    assert.throws(() => f.store.action('floor-a', { action: 'add', campaign: c, instructions: 'Third idea', requestId: 'add-2' }), /budget/);
    f.store.action('floor-a', { action: 'release', assignment: a, lease, reason: 'Worker disconnected' });
    f.store.action('floor-a', { action: 'assign', assignment: a, worker: 'r1' });
    assert.throws(() => f.store.action('floor-a', { action: 'submit', assignment: a, lease, worker: 'r1', hypothesis: 'old result', code, config }), /lease changed/);
    f.store.action('floor-a', { action: 'pause', campaign: c, paused: true });
    const current = f.store.state('floor-a').assignments[0];
    assert.throws(() => f.store.action('floor-a', { action: 'submit', assignment: a, lease: current.lease!, worker: 'r1', hypothesis: 'draft', code, config }), /paused/);
    assert.equal(f.store.state('floor-a').experiments.length, 0);
  } finally { f.close(); }
});
test('completed execution creates an independent review, without granting promotion eligibility', async () => {
  const f = fixture(); let scheduler: ResearchScheduler | undefined;
  try {
    const { state } = submit(f.store);
    const fake = { options: {}, local: async () => ({ phases: [{ phase: 'quick_filter', total_trades: 2, total_pnl: -3 }], promotionStatus: 'RESEARCH' }) } as unknown as DiscoveryAdapter;
    scheduler = new ResearchScheduler(f.store, fake); await scheduler.tick(); await new Promise(r => setTimeout(r, 20));
    const current = f.store.state('floor-a'), review = current.assignments.find(a => a.role === 'reviewer')!;
    assert.equal(current.experiments[0].status, 'completed'); assert.equal(current.experiments[0].outcome, 'research');
    assert.throws(() => f.store.action('floor-a', { action: 'assign', assignment: review.id, worker: 'researcher' }), /own experiment/);
    const assigned = f.store.action('floor-a', { action: 'assign', assignment: review.id, worker: 'critic' }).assignments.find(a => a.id === review.id)!;
    f.store.action('floor-a', { action: 'review', assignment: review.id, lease: assigned.lease!, worker: 'critic', decision: 'reject', summary: 'Negative results with explicit costs; hypothesis unsupported.' });
    assert.equal(f.store.state('floor-a').experiments[0].outcome, 'rejected');
    assert.equal(state.experiments[0].hash, f.store.state('floor-a').experiments[0].hash);
  } finally { await scheduler?.stop(); f.close(); }
});
test('restart interrupts local execution and does not automatically duplicate a run', async () => {
  const f = fixture(); try {
    const { state } = submit(f.store); state.experiments[0].status = 'running'; state.experiments[0].attempts = 1; f.store.save('floor-a', state);
    let runs = 0;
    const fake = { options: {}, local: async () => { runs++; return {}; } } as unknown as DiscoveryAdapter;
    const scheduler = new ResearchScheduler(new ResearchStore(f.dir), fake); await scheduler.tick();
    assert.equal(scheduler.store.state('floor-a').experiments[0].status, 'interrupted'); assert.equal(runs, 0); await scheduler.stop();
  } finally { f.close(); }
});
test('ambiguous remote submission reconciles by batch after restart without resubmission or losing concurrent actions', async () => {
  const f = fixture(); try {
    const { state } = submit(f.store); let submissions = 0;
    const fake = { options: { orcatrex: 'http://test' }, submitRemote: async () => {
      submissions++; f.store.action('floor-a', { action: 'pause', campaign: state.campaigns[0].id, paused: true }); throw Error('Lost response');
    }, remote: async () => ({ metrics: { phases: [{ total_pnl: 1 }], promotionStatus: 'RESEARCH' }, jobId: 42 }) } as unknown as DiscoveryAdapter;
    const first = new ResearchScheduler(f.store, fake); await first.tick(); await first.stop();
    assert.equal(f.store.state('floor-a').experiments[0].status, 'blocked'); assert.equal(f.store.state('floor-a').campaigns[0].paused, true);
    const second = new ResearchScheduler(new ResearchStore(f.dir), fake); await second.tick(); await second.stop();
    assert.equal(submissions, 1); assert.equal(second.store.state('floor-a').experiments[0].jobId, 42); assert.equal(second.store.state('floor-a').experiments[0].status, 'completed');
  } finally { f.close(); }
});
test('manual submission is validated and duplicate strategies cannot waste the experiment budget', () => {
  const f = fixture(); try {
    const state = campaign(f.store), a = state.assignments[0].id;
    assert.throws(() => f.store.action('floor-a', { action: 'manual', assignment: a, hypothesis: 'x', code, config: 'invalid' }));
    assert.equal(f.store.state('floor-a').assignments[0].status, 'queued');
    f.store.action('floor-a', { action: 'manual', assignment: a, hypothesis: 'x', code, config });
    const added = f.store.action('floor-a', { action: 'add', campaign: state.campaigns[0].id, instructions: 'another', requestId: 'next' });
    assert.throws(() => f.store.action('floor-a', { action: 'manual', assignment: added.assignments[1].id, hypothesis: 'y', code, config }), /Duplicate/);
    assert.equal(f.store.state('floor-a').experiments.length, 1);
  } finally { f.close(); }
});
test('brief validation and local-only coordinator URLs reject malformed dates and unsafe endpoints', () => {
  assert.throws(() => researchBrief({ ...brief, start: '20230230' })); assert.throws(() => researchBrief({ ...brief, maxWorkers: 0 }));
  for (const url of ['http://example.com', 'http://127.0.0.1@evil.test', 'file:///tmp/x', 'http://localhost/path', 'http://localhost/?x=1']) assert.throws(() => coordinatorUrl(url));
  assert.equal(coordinatorUrl('http://127.0.0.1:4601'), 'http://127.0.0.1:4601');
});
test('result parsing retains all evaluation phases and rejects missing or malformed evidence', () => {
  const output = '===DISCOVERY_RESULT_JSON===\n{"phase":"quick_filter","total_pnl":-1}\n===END_DISCOVERY_RESULT_JSON===\n===DISCOVERY_RESULT_JSON===\n{"phase":"walk_forward"}\n===END_DISCOVERY_RESULT_JSON===';
  const value = parseEvaluation(output); assert.equal((value.phases as unknown[]).length, 2); assert.equal(value.promotionStatus, 'RESEARCH');
  assert.throws(() => parseEvaluation('no results')); assert.throws(() => parseEvaluation('===DISCOVERY_RESULT_JSON===broken===END_DISCOVERY_RESULT_JSON==='));
});


test('local cancellation retains the running slot until the evaluator confirms exit', async () => {
  const f = fixture(); let scheduler: ResearchScheduler | undefined;
  try {
    const { state } = submit(f.store), id = state.experiments[0].id;
    let acknowledge: (() => void) | undefined, aborted = false;
    const fake = { options: {}, local: (_e: unknown, _b: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; acknowledge = () => reject(Error('Evaluator stopped')); });
    }) } as unknown as DiscoveryAdapter;
    scheduler = new ResearchScheduler(f.store, fake); await scheduler.tick();
    f.store.action('floor-a', { action: 'cancel', experiment: id }); await scheduler.tick();
    assert.equal(aborted, true); assert.equal(f.store.state('floor-a').experiments[0].status, 'running');
    acknowledge!(); await scheduler.stop();
    assert.equal(f.store.state('floor-a').experiments[0].status, 'cancelled');
    assert.equal(f.store.state('floor-a').assignments.some(a => a.role === 'reviewer'), false);
  } finally { await scheduler?.stop(); f.close(); }
});

test('remote cancellation waits for a terminal status and never submits a replacement', async () => {
  const f = fixture(); let scheduler: ResearchScheduler | undefined;
  try {
    const { state } = submit(f.store), id = state.experiments[0].id; let terminal = false, submissions = 0, cancellations = 0;
    const fake = { options: { orcatrex: 'http://fixture' }, submitRemote: async () => { submissions++; return 42; },
      remote: async () => terminal ? { terminal: true, error: 'Cancelled', jobId: 42 } : { pending: true, jobId: 42 },
      cancelRemote: async () => { cancellations++; } } as unknown as DiscoveryAdapter;
    scheduler = new ResearchScheduler(f.store, fake); await scheduler.tick();
    f.store.action('floor-a', { action: 'cancel', experiment: id }); await scheduler.tick();
    assert.equal(f.store.state('floor-a').experiments[0].status, 'blocked'); assert.equal(cancellations, 1);
    terminal = true; await scheduler.tick(); assert.equal(f.store.state('floor-a').experiments[0].status, 'cancelled'); assert.equal(submissions, 1);
  } finally { await scheduler?.stop(); f.close(); }
});

test('retry refuses to duplicate an evaluator whose recorded PID is still alive', () => {
  const f = fixture(); try {
    const { state } = submit(f.store), e = state.experiments[0]; e.status = 'interrupted'; e.attempts = 1; e.localPid = process.pid; f.store.save('floor-a', state);
    assert.throws(() => f.store.action('floor-a', { action: 'retry', experiment: e.id }), /still alive/);
    assert.equal(f.store.state('floor-a').experiments[0].status, 'interrupted');
  } finally { f.close(); }
});


test('OrcaTrex compact summaries preserve screening, walk-forward and dataset evidence', () => {
  const value = parseEvaluation('===WORKER_RESULT_JSON===\n' + JSON.stringify({ phases: [{ phase: 'quick_filter' }, { phase: 'walk_forward' }], datasetFingerprints: { EURUSD: { sha256: 'fixture' } }, promotionStatus: 'ELIGIBLE' }) + '\n===END_WORKER_RESULT_JSON===');
  assert.equal((value.phases as unknown[]).length, 2); assert.equal(value.promotionStatus, 'RESEARCH');
  assert.deepEqual(value.datasetFingerprints, { EURUSD: { sha256: 'fixture' } });
  assert.throws(() => parseEvaluation('===WORKER_RESULT_JSON==={"phases":[]}===END_WORKER_RESULT_JSON==='));
});
