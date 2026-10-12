import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ResearchAction } from '../../../shared/trading-research.js';
import { readBody, send } from '../../http/util.js';
import type { ResearchStore } from './store.js';

export function researchServer(store: ResearchStore, token: string) {
  if (token.length < 32) throw Error('Coordinator token must have at least 32 characters');
  return http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    const provided = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')), expected = Buffer.from(token);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(res, 401, { error: 'Coordinator authentication required' });
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { service: 'office-research', version: 1, paidAi: false });
      const match = /^\/v1\/scopes\/([a-zA-Z0-9_-]{1,80})\/(state|action|packet)$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: 'No such research endpoint' });
      const [, scope, endpoint] = match;
      if (endpoint === 'state' && req.method === 'GET') return send(res, 200, store.state(scope));
      if (endpoint === 'action' && req.method === 'POST') return send(res, 200, store.action(scope, JSON.parse(await readBody(req, 256_000)) as ResearchAction));
      if (endpoint === 'packet' && req.method === 'GET') {
        const state = store.state(scope), worker = url.searchParams.get('worker'), wanted = url.searchParams.get('assignment');
        const assignment = state.assignments.find(a => a.worker === worker && a.status === 'assigned' && (!wanted || a.id === wanted));
        if (!assignment) return send(res, 200, { assignment: null });
        const campaign = state.campaigns.find(c => c.id === assignment.campaign)!;
        const experiment = state.experiments.find(e => e.id === assignment.experiment);
        return send(res, 200, { assignment, brief: campaign.brief, ...(experiment ? { experiment,
          code: readFileSync(store.artifact(experiment.id, 'strategy.py'), 'utf8'), config: readFileSync(store.artifact(experiment.id, 'strategy.cfg'), 'utf8') } : {}) });
      }
      return send(res, 405, { error: 'Unsupported research operation' });
    } catch (error) { return send(res, 400, { error: (error as Error).message }); }
  });
}
