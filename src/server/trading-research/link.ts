import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ResearchAction, ResearchConnection, ResearchState, ResearchView } from '../../shared/trading-research.js';
import type { FloorActions } from '../floor-actions.js';
import { canRest, isAsleep } from '../../shared/status.js';
import { teamTargetError } from '../master-workers/role.js';

export interface ResearchSurface {
  view(): Promise<ResearchView>;
  configure(body: { enabled: boolean; url: string; token?: string }): Promise<ResearchView>;
  action(body: ResearchAction): Promise<ResearchView>;
  dispatch(assignment: string, worker: string, by: string): Promise<ResearchView>;
}
declare module '../floor-actions.js' { interface FloorActions { readonly research?: ResearchSurface; } }
export function coordinatorUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw Error('Provide a coordinator URL');
  const u = new URL(raw);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('Use the coordinator’s loopback HTTP URL on this floor host');
  return u.origin;
}
export function publicResearch(state: ResearchState): ResearchState {
  return { ...state, assignments: state.assignments.map(({ lease: _lease, ...a }) => a) };
}
export class ResearchLink implements ResearchSurface {
  private connection: ResearchConnection;
  private file: string;
  constructor(private floor: FloorActions) {
    this.file = path.join(floor.dir, '.agent-office/research.json');
    this.connection = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { enabled: false, url: 'http://127.0.0.1:4601', token: '', scope: randomUUID() };
    if (!/^[a-f0-9-]{36}$/.test(this.connection.scope)) throw Error('Invalid research connection file');
  }
  async call(endpoint: string, body?: ResearchAction) {
    const c = this.connection;
    if (!c.enabled) throw Error('Enable Trading Research on this floor first');
    const r = await fetch(`${coordinatorUrl(c.url)}/v1/scopes/${c.scope}/${endpoint}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const text = await r.text(); if (text.length > 4_000_000) throw Error('Coordinator response exceeded limit');
    const value = JSON.parse(text);
    if (!r.ok) throw Error(typeof value.error === 'string' ? value.error : `Coordinator returned ${r.status}`);
    return value;
  }
  async view(): Promise<ResearchView> {
    const base = { enabled: this.connection.enabled, url: this.connection.url, connected: false };
    if (!base.enabled) return base;
    try { return { ...base, connected: true, state: publicResearch(await this.call('state')) }; }
    catch (error) { return { ...base, error: (error as Error).message }; }
  }
  async configure(body: { enabled: boolean; url: string; token?: string }) {
    if (typeof body.enabled !== 'boolean') throw Error('Choose whether Trading Research is enabled');
    const url = coordinatorUrl(body.url), token = body.token || this.connection.token;
    if (body.enabled && (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(token))) throw Error('Provide the coordinator token from its token file');
    const next = { ...this.connection, enabled: body.enabled, url, token };
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 }); renameSync(`${this.file}.tmp`, this.file); this.connection = next;
    return this.view();
  }
  async action(body: ResearchAction) {
    if (!['create', 'pause', 'add', 'retry', 'cancel', 'release', 'manual'].includes(body?.action)) throw Error('Use the worker submission tool for assignment results');
    if (body.action === 'release') {
      const assignment = body.assignment;
      const s = await this.call('state') as ResearchState, a = s.assignments.find(a => a.id === assignment);
      if (!a?.lease) throw Error('Assignment is not active');
      body = { ...body, lease: a.lease };
    }
    await this.call('action', body); return this.view();
  }
  async dispatch(id: string, workerId: string, by: string) {
    const w = this.floor.workers.get(workerId);
    if (!w || w.kind !== 'agent' || w.helper || w.meeting || w.planReview || w.resting || w.lost || w.deskId.startsWith('station-') || teamTargetError(w)) throw Error('Choose an ordinary coding worker on this floor');
    if (!canRest(w) && !isAsleep(w.status)) throw Error('Worker is busy; choose a ready worker');
    let state = await this.call('action', { action: 'assign', assignment: id, worker: workerId }) as ResearchState;
    const a = state.assignments.find(a => a.id === id)!;
    const prompt = `You are the ${a.role} for a Trading Research assignment.\nAssignment: ${a.id}\n${a.instructions}\nRun office-workers research task to retrieve your brief, lease and available evidence. Use the existing Tradeai strategy interfaces as references. Work in your own workspace; do not modify Discovery, shared strategies, or submit trading orders.\nSubmit a JSON result with office-workers research submit < result.json. Researchers supply assignment, lease, hypothesis, code and config; reviewers supply assignment, lease, summary and decision (reject, revise or retain). These tools authenticate your identity. Do not use paid model APIs. If your agent allowance is exhausted, keep the draft and wait.\nOnly the coordinator's measured results count as experiment evidence. A successful test remains research, not paper-trading approval.`;
    let error: string | undefined;
    try { error = isAsleep(w.status) ? await this.floor.workers.resume(workerId, prompt) : await this.floor.workers.prompt(workerId, prompt, by); }
    catch (e) { error = (e as Error).message; }
    if (error) {
      await this.call('action', { action: 'release', assignment: a.id, lease: a.lease!, reason: `Prompt delivery failed: ${error}` }); throw Error(error);
    }
    state = await this.call('state');
    return { enabled: true, url: this.connection.url, connected: true, state: publicResearch(state) };
  }
}
const links = new WeakMap<FloorActions, ResearchLink>();
export function localResearch(floor: FloorActions): ResearchLink {
  let link = links.get(floor); if (!link) { link = new ResearchLink(floor); links.set(floor, link); } return link;
}
export function researchSurface(floor: FloorActions): ResearchSurface { return floor.research ?? localResearch(floor); }
