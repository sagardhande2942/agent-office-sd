import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emptyResearch, researchBrief, researchText, type ResearchAction, type ResearchAssignment, type ResearchState } from '../../../shared/trading-research.js';

interface Journal { scopes: Record<string, ResearchState>; requests: Record<string, string>; }
export class ResearchStore {
  private journal: Journal;
  readonly file: string;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true }); this.file = path.join(dir, 'journal.json');
    this.journal = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { scopes: {}, requests: {} };
    if (!this.journal.scopes || !this.journal.requests) throw Error('Invalid research journal; restore a backup rather than overwrite it');
  }
  scopes() { return Object.keys(this.journal.scopes); }
  state(scope: string): ResearchState {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(scope)) throw Error('Invalid research scope');
    return this.journal.scopes[scope] ?? emptyResearch();
  }
  save(scope: string, state: ResearchState) {
    this.journal.scopes[scope] = state; state.revision++;
    const tmp = `${this.file}.tmp`; writeFileSync(tmp, JSON.stringify(this.journal), { mode: 0o600 }); renameSync(tmp, this.file);
  }
  artifact(id: string, name: 'strategy.py' | 'strategy.cfg' | 'manifest.json' | 'result.json' | 'execution.log') {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid experiment ID');
    return path.join(this.dir, 'experiments', id, name);
  }
  action(scope: string, input: ResearchAction) {
    // Mutate a copy: rejected requests never leave partial in-memory state behind.
    const s = structuredClone(this.state(scope)); let b = input as ResearchAction;
    if (!b || typeof b !== 'object') throw Error('Provide a research action');
    const campaign = (id: string) => { const c = s.campaigns.find(c => c.id === id); if (!c) throw Error('No such campaign'); return c; };
    const assignment = (id: string) => { const a = s.assignments.find(a => a.id === id); if (!a) throw Error('No such assignment'); return a; };
    const lease = (id: string, token: string, worker: string, role: ResearchAssignment['role']) => {
      const a = assignment(id);
      if (a.role !== role || a.worker !== worker || a.lease !== token || !token) throw Error('Assignment belongs to another worker or its lease changed');
      if (!['assigned', 'submitted'].includes(a.status)) throw Error('Assignment is no longer active');
      return a;
    };
    const request = (id: string) => { researchText(id, 'Request ID', 80); return `${scope}:${b.action}:${id}`; };
    if (b.action === 'manual') {
      const a = assignment(b.assignment);
      if (a.role !== 'researcher' || a.status !== 'queued') throw Error('Choose an unassigned research task for manual submission');
      a.worker = 'manual'; a.lease = randomUUID(); a.status = 'assigned';
      b = { ...b, action: 'submit', lease: a.lease, worker: 'manual' };
    }
    if (b.action === 'create') {
      const brief = researchBrief(b.brief), key = request(b.requestId);
      if (this.journal.requests[key]) return s;
      if (s.campaigns.length >= 100) throw Error('Campaign limit reached');
      const id = randomUUID(); s.campaigns.push({ id, brief, paused: false, created: Date.now() });
      s.assignments.push({ id: randomUUID(), campaign: id, role: 'researcher', instructions: brief.objective, status: 'queued' });
      this.journal.requests[key] = id;
    } else if (b.action === 'pause') {
      if (typeof b.paused !== 'boolean') throw Error('paused must be boolean'); campaign(b.campaign).paused = b.paused;
    } else if (b.action === 'add') {
      const c = campaign(b.campaign), key = request(b.requestId);
      if (this.journal.requests[key]) return s;
      const used = s.assignments.filter(a => a.campaign === c.id && a.role === 'researcher').length;
      if (used >= c.brief.maxExperiments) throw Error('Campaign hypothesis budget exhausted');
      const id = randomUUID(); s.assignments.push({ id, campaign: c.id, role: 'researcher', instructions: researchText(b.instructions, 'Hypothesis instructions', 4000), status: 'queued' });
      this.journal.requests[key] = id;
    } else if (b.action === 'assign') {
      const a = assignment(b.assignment), c = campaign(a.campaign);
      if (c.paused) throw Error('Campaign is paused');
      if (a.status !== 'queued') throw Error('Assignment is already taken');
      const worker = researchText(b.worker, 'Worker ID', 80);
      if (a.role === 'reviewer') {
        const original = s.experiments.find(e => e.id === a.experiment);
        if (s.assignments.find(t => t.id === original?.assignment)?.worker === worker) throw Error('Researcher cannot review its own experiment');
      }
      if (s.assignments.some(t => t.worker === worker && t.status === 'assigned')) throw Error('Worker already has an active assignment');
      if (s.assignments.filter(t => t.campaign === c.id && t.status === 'assigned').length >= c.brief.maxWorkers) throw Error('Campaign worker limit reached');
      a.worker = worker; a.lease = randomUUID(); a.status = 'assigned'; a.error = undefined;
    } else if (b.action === 'release') {
      const a = assignment(b.assignment);
      if (a.lease !== b.lease || a.status !== 'assigned') throw Error('Assignment lease changed');
      a.status = 'queued'; a.worker = undefined; a.lease = undefined; a.error = researchText(b.reason, 'Release reason', 500);
    } else if (b.action === 'submit') {
      const a = lease(b.assignment, b.lease, b.worker, 'researcher');
      const code = researchText(b.code, 'Strategy code', 100_000), config = researchText(b.config, 'Strategy config', 50_000);
      const configuration = JSON.parse(config);
      if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) || !configuration.config || !configuration.RMS) throw Error('Strategy config must be a JSON object containing config and RMS');
      const hypothesis = researchText(b.hypothesis, 'Hypothesis', 4000);
      const hash = createHash('sha256').update(code).update('\0').update(config).digest('hex');
      if (a.status === 'submitted') {
        if (s.experiments.find(e => e.id === a.experiment)?.hash === hash) return s;
        throw Error('This assignment already submitted a different strategy');
      }
      const c = campaign(a.campaign);
      if (c.paused) throw Error('Campaign is paused; keep the draft and submit after resuming');
      if (s.experiments.filter(e => e.campaign === c.id).length >= c.brief.maxExperiments) throw Error('Experiment budget exhausted');
      if (s.experiments.some(e => e.campaign === c.id && e.hash === hash)) throw Error('Duplicate strategy and config already submitted');
      const id = randomUUID(), strategy = `office_${id.replaceAll('-', '')}`;
      mkdirSync(path.dirname(this.artifact(id, 'strategy.py')), { recursive: true });
      writeFileSync(this.artifact(id, 'strategy.py'), code); writeFileSync(this.artifact(id, 'strategy.cfg'), config);
      writeFileSync(this.artifact(id, 'manifest.json'), JSON.stringify({ id, strategy, hash, hypothesis, brief: c.brief, worker: b.worker, created: Date.now() }));
      s.experiments.push({ id, campaign: c.id, assignment: a.id, hypothesis, hash, strategy, status: 'queued', outcome: 'research', created: Date.now(), attempts: 0 });
      a.status = 'submitted'; a.experiment = id;
    } else if (b.action === 'review') {
      const a = lease(b.assignment, b.lease, b.worker, 'reviewer'), e = s.experiments.find(e => e.id === a.experiment);
      if (!e || !['reject', 'revise', 'retain'].includes(b.decision)) throw Error('Provide a review decision for this experiment');
      const summary = researchText(b.summary, 'Review summary', 8000);
      if (a.status === 'submitted') {
        if (e.review?.summary === summary && e.review.decision === b.decision) return s;
        throw Error('Review is already submitted');
      }
      if (s.assignments.find(t => t.id === e.assignment)?.worker === b.worker) throw Error('Researcher cannot review its own experiment');
      e.review = { summary, decision: b.decision, worker: b.worker }; e.outcome = b.decision === 'reject' ? 'rejected' : b.decision === 'revise' ? 'needs-work' : 'reviewed'; a.status = 'submitted';
    } else if (b.action === 'retry' || b.action === 'cancel') {
      const e = s.experiments.find(e => e.id === b.experiment); if (!e) throw Error('No such experiment');
      if (b.action === 'retry') {
        if (!['failed', 'interrupted'].includes(e.status) || e.batch) throw Error('Only a confirmed stopped local run can be retried');
        if (e.attempts >= 2) throw Error('Execution retry limit reached');
        if (campaign(e.campaign).paused) throw Error('Resume the campaign first');
        if (e.localPid) {
          let running = true;
          try { process.kill(e.localPid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false; }
          if (running) throw Error('The previous evaluator process is still alive; wait for it to stop before retrying');
        }
        e.status = 'queued'; e.error = undefined; e.localPid = undefined; e.cancelRequested = false;
      } else {
        if (!['queued', 'running', 'blocked'].includes(e.status)) throw Error('Experiment has already stopped');
        if (e.status === 'queued') { e.status = 'cancelled'; e.finished = Date.now(); }
        else e.cancelRequested = true;
      }
    } else throw Error('Unknown research action');
    this.save(scope, s); return s;
  }
}
