import { workflowProblem, type MeetingWorkflow } from '../../shared/meeting-workflows.js';
export interface QueueTask {
  execution?: 'meeting' | 'worker'; id: string; group: string; title: string; workflow: MeetingWorkflow; references?: string[]; version: number;
  input: Record<string, unknown>; claim_token?: string; execution_key?: string;
}
export function taskProblem(t: QueueTask): string | undefined {
  const safe=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!['__proto__','constructor','prototype'].includes(v);
  if (!t || typeof t!=='object' || !safe(t.id,200) || !safe(t.group,100) || !safe(t.title,100) || !Number.isInteger(t.version) || t.version<1
    || !t.input || typeof t.input!=='object' || Array.isArray(t.input)
    || t.references!==undefined && (!Array.isArray(t.references)||t.references.length>20||t.references.some(v=>!safe(v,100)))) return 'Invalid meeting task envelope';
  const bad = workflowProblem(t.workflow); if (bad) return bad;
  if (t.execution !== undefined && !['meeting','worker'].includes(t.execution)) return 'Unknown task execution';
  if (t.execution === 'worker' && (t.workflow.roles.length !== 1 || t.workflow.stages.length !== 1 || !t.workflow.stages[0].turns[0]?.output)) return 'Worker tasks require one role and one final stage';
  if (t.execution !== 'worker' && t.workflow.roles.length < 2) return 'Meeting tasks need at least two roles';
}
export class BridgeError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export interface Bridge { call<T>(operation: string, body?: unknown): Promise<T> }
export class TaskBridge implements Bridge {
  constructor(private endpoint: string, private floor: string, private token: string) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/tasks/v1/' || url.username || url.password || url.search || url.hash)
      throw Error('Task bridge must be http://127.0.0.1:PORT/tasks/v1/');
    if (token.length < 32) throw Error('Task bridge credential is missing or too short');
  }
  async call<T>(operation: string, body?: unknown): Promise<T> {
    if (!/^[a-z-]+$/.test(operation)) throw Error('Invalid bridge operation');
    const response = await fetch(this.endpoint + operation, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + this.token, 'X-Office-Floor': this.floor, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
    const raw = await response.text(); if (raw.length > 2 * 1024 * 1024) throw Error('Oversized task bridge response');
    const result = JSON.parse(raw);
    if (!response.ok) throw new BridgeError(response.status, `Task bridge ${response.status}: ${String(result.error ?? 'operation refused').slice(0, 500)}`);
    return result as T;
  }
}
