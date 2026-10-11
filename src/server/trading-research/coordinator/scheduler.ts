import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ResearchExperiment } from '../../../shared/trading-research.js';
import { DiscoveryAdapter } from './adapter.js';
import { ResearchStore } from './store.js';

/** One scheduler owns execution. Browser and worker lifetimes never own backtests. */
export class ResearchScheduler {
  private active = new Map<string, AbortController>();
  private timer?: NodeJS.Timeout;
  private polling = false;
  private jobs = new Set<Promise<void>>();
  private closed = false;
  constructor(readonly store: ResearchStore, readonly adapter: DiscoveryAdapter, readonly concurrency = 2) {
    for (const scope of store.scopes()) {
      const state = store.state(scope); let changed = false;
      for (const e of state.experiments) if (e.status === 'running' && !e.batch) {
        e.status = 'interrupted'; e.error = 'Coordinator restarted during local execution. Confirm the old evaluator stopped, then retry explicitly.'; changed = true;
      }
      if (changed) store.save(scope, state);
    }
  }
  start() { this.timer = setInterval(() => void this.tick(), 2000); this.timer.unref(); void this.tick(); }
  async stop() {
    this.closed = true; clearInterval(this.timer); this.active.forEach(c => c.abort());
    while (this.polling) await new Promise(resolve => setTimeout(resolve, 20));
    await Promise.allSettled(this.jobs);
  }
  async tick() {
    if (this.closed || this.polling) return;
    this.polling = true;
    try {
      for (const scope of this.store.scopes()) {
        const ids = this.store.state(scope).experiments.map(e => e.id);
        for (const id of ids) {
          if (this.closed) return;
          let state = this.store.state(scope), e = state.experiments.find(e => e.id === id)!;
          let campaign = state.campaigns.find(c => c.id === e.campaign)!;
          if (e.cancelRequested && !e.batch) this.active.get(id)?.abort();
          if ((e.status === 'running' || e.status === 'blocked') && e.batch) {
            try {
              const result = await this.adapter.remote(e);
              // HTTP actions may replace a scope while awaiting external I/O.
              state = this.store.state(scope); e = state.experiments.find(e => e.id === id)!;
              if (result.jobId) e.jobId = result.jobId;
              if (result.metrics) this.finish(scope, e.id, result.metrics);
              else if (result.terminal) this.finish(scope, id, undefined, result.error);
              else if (e.cancelRequested || Date.now() - e.started! > campaign.brief.timeoutMinutes * 60_000) {
                await this.adapter.cancelRemote(e);
                this.update(scope, id, current => { current.cancelRequested = true; current.status = 'blocked'; current.error = 'Cancellation requested. Waiting for OrcaTrex to confirm termination.'; });
              } else { e.error = undefined; e.status = 'running'; this.store.save(scope, state); }
            } catch (error) {
              // Transport errors and ambiguous submissions never cause automatic resubmission.
              this.update(scope, id, current => { current.status = 'blocked'; current.error = (error as Error).message; });
            }
          }
          state = this.store.state(scope); e = state.experiments.find(e => e.id === id)!;
          campaign = state.campaigns.find(c => c.id === e.campaign)!;
          if (e.status !== 'queued' || campaign.paused || this.active.size >= this.concurrency) continue;
          const remoteCount = this.store.scopes().flatMap(k => this.store.state(k).experiments).filter(x => x.batch && ['running', 'blocked'].includes(x.status)).length;
          if (this.active.size + remoteCount >= this.concurrency) continue;
          e.status = 'running'; e.started = Date.now(); e.attempts++;
          if (this.adapter.options.orcatrex) e.batch = `office-research-${e.id}`;
          this.store.save(scope, state);
          if (e.batch) {
            try { const jobId = await this.adapter.submitRemote(e, campaign.brief); this.update(scope, id, current => { current.jobId = jobId; }); }
            catch (error) { this.update(scope, id, current => { current.status = 'blocked'; current.error = `${(error as Error).message}. Submission may have succeeded; no automatic retry.`; }); }
          } else {
            const controller = new AbortController(); this.active.set(e.id, controller);
            const timeout = setTimeout(() => controller.abort(), campaign.brief.timeoutMinutes * 60_000);
            const job = this.adapter.local(e, campaign.brief, controller.signal, chunk => appendFileSync(this.store.artifact(e.id, 'execution.log'), chunk), pid => this.update(scope, id, current => { current.localPid = pid; }))
              .then(metrics => this.finish(scope, e.id, metrics))
              .catch(error => this.finish(scope, e.id, undefined, (error as Error).message))
              .finally(() => { clearTimeout(timeout); this.active.delete(e.id); this.jobs.delete(job); });
            this.jobs.add(job);
          }
        }
      }
    } finally { this.polling = false; }
  }
  private update(scope: string, id: string, apply: (e: ResearchExperiment) => void) {
    const state = this.store.state(scope); apply(state.experiments.find(e => e.id === id)!); this.store.save(scope, state);
  }
  private finish(scope: string, id: string, metrics?: Record<string, unknown>, error?: string) {
    const state = this.store.state(scope), e = state.experiments.find(e => e.id === id)!;
    e.finished = Date.now(); e.status = e.cancelRequested ? 'cancelled' : this.closed ? 'interrupted' : metrics ? 'completed' : 'failed'; e.metrics = metrics; e.error = error; e.localPid = undefined;
    if (metrics && e.status === 'completed') {
      writeFileSync(this.store.artifact(id, 'result.json'), JSON.stringify(metrics));
      if (!state.assignments.some(a => a.role === 'reviewer' && a.experiment === id)) state.assignments.push({ id: randomUUID(), campaign: e.campaign, role: 'reviewer', status: 'queued', experiment: id,
        instructions: 'Independently review the hypothesis, strategy code and measured development results. Check future-data leakage, costs, dataset fingerprints and fragile assumptions. A retained candidate is research only.' });
    }
    this.store.save(scope, state);
  }
}
