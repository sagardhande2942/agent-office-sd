import type { ResearchAction, ResearchView } from '../../shared/trading-research.js';
import type { ResearchSurface } from './link.js';
export class RemoteResearch implements ResearchSurface {
  constructor(private call: (t: string, body: Record<string, unknown>) => Promise<unknown>, private supported: () => boolean) {}
  private async request(t: string, body: Record<string, unknown> = {}) {
    if (!this.supported()) throw Error('Update the floor host to use Trading Research');
    const value = await this.call(t, body); if (typeof value === 'string') throw Error(value); return value as ResearchView;
  }
  view() { return this.request('research.get'); }
  configure(body: { enabled: boolean; url: string; token?: string }) { return this.request('research.configure', body); }
  action(body: ResearchAction) { return this.request('research.action', { body }); }
  dispatch(assignment: string, worker: string, by: string) { return this.request('research.dispatch', { assignment, worker, by }); }
}
