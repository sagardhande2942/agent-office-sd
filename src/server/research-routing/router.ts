import { randomBytes, createHash } from 'node:crypto';
import { BridgeError, type Bridge, type QueueTask } from './bridge.js';
import { readRouting, saveRouting, type Attempt } from './storage.js';

export interface RoutedMeeting { id: string; key?: string; state: 'running' | 'done' | 'stopped'; result?: unknown; error?: string }
export interface RoutingIO {
  allowed(): string | undefined;
  available(pattern: string, department: string): boolean;
  find(key: string): RoutedMeeting | undefined;
  retire?(meetingId: string, key: string): Promise<void>;
  start(task: QueueTask, key: string, id: string): Promise<RoutedMeeting>;
}
/** Durable intent precedes every claim/start. Unknown outcomes never authorize another start. */
export class TeamRouter {
  private busy = false;
  private state;
  constructor(private file: string, private bridge: Bridge, private io: RoutingIO, private dispatcher: string, private maxMeetings = 2) {
    this.state = readRouting(file);
  }
  snapshot() { return structuredClone(this.state); }
  private save() { saveRouting(this.file, this.state); }
  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.save(); // Never make a new external mutation while local intent cannot be persisted.
      const health = await this.bridge.call<{ schema_version: number; capabilities: string[] }>('health');
      if (health.schema_version !== 1 || !health.capabilities.includes('team-queues-v1')) throw Error('Incompatible research bridge');
      for (const a of Object.values(this.state.attempts)) {
        if (a.state === 'done' || (a.nextPoll ?? 0) > Date.now()) continue;
        try { await this.advance(a); delete a.error; a.failures = 0; delete a.nextPoll; }
        catch (error) { this.failed(a, error); }
        this.save();
      }
      const refused = this.io.allowed(); if (refused) { this.state.error = refused; this.save(); return; }
      const { tasks } = await this.bridge.call<{ tasks: QueueTask[] }>('ready');
      for (const task of tasks.slice(0, 100)) {
        if (Object.values(this.state.attempts).filter(a => a.state !== 'done').length >= this.maxMeetings) break;
        if (this.state.attempts[task.id] || !this.io.available(task.pattern, task.department)) continue;
        const a: Attempt = { task, claimKey: randomBytes(24).toString('hex'), state: 'claiming' };
        this.state.attempts[task.id] = a; this.save();
        try { await this.advance(a); }
        catch (error) { this.failed(a, error); }
        this.save();
      }
      const done = Object.entries(this.state.attempts).filter(([, a]) => a.state === 'done');
      for (const [id] of done.slice(0, Math.max(0, done.length - 50))) delete this.state.attempts[id];
      delete this.state.error; this.save();
    } catch (error) { this.state.error = (error as Error).message; this.save(); }
    finally { this.busy = false; }
  }
  private failed(a: Attempt, error: unknown) {
    a.error = (error as Error).message; a.failures = (a.failures ?? 0) + 1;
    a.nextPoll = Date.now() + Math.min(300000, 5000 * 2 ** Math.min(a.failures - 1, 6));
  }
  private async advance(a: Attempt) {
    if (a.result) {
      await this.deliver(a); return;
    }
    if (a.failure) {
      await this.bridge.call('fail', { task_id: a.task.id, token: a.task.claim_token, reason: a.failure });
      await this.io.retire?.(a.meetingId!, a.task.execution_key!);
      a.state = 'done'; this.save(); return;
    }
    if (a.state === 'claiming') {
      const denied = this.io.allowed(); if (denied) throw Error(denied);
      a.task = await this.bridge.call<QueueTask>('claim', { task_id: a.task.id, version: a.task.version,
        dispatcher: this.dispatcher, claim_key: a.claimKey });
      if (!a.task.claim_token || !a.task.execution_key) throw Error('Malformed claim response');
      a.state = 'starting'; this.save();
      // Only this fresh execution of the acknowledged claim may initiate a meeting.
      const existing = this.io.find(a.task.execution_key);
      if (existing) a.meetingId = existing.id;
      else {
        const refused = this.io.allowed(); if (refused) throw Error(refused);
        if (!this.io.available(a.task.pattern, a.task.department)) throw Error('Department capacity changed after claim; inspect durable start intent');
        const id = createHash('sha256').update(a.task.execution_key).digest('hex').slice(0, 16);
        const m = await this.io.start(a.task, a.task.execution_key, id);
        a.meetingId = m.id;
      }
      a.state = 'running'; this.save();
    }
    if (a.state === 'starting' || a.state === 'unresolved') {
      const m = this.io.find(a.task.execution_key!);
      if (!m) { a.state = 'unresolved'; throw Error('Meeting start unresolved; inspect Office sessions. No automatic replay.'); }
      a.meetingId = m.id; a.state = 'running'; this.save();
    }
    if (a.state !== 'running') return;
    await this.bridge.call('heartbeat', { task_id: a.task.id, token: a.task.claim_token, meeting_id: a.meetingId });
    const m = this.io.find(a.task.execution_key!);
    if (!m) { a.state = 'unresolved'; throw Error('Routed meeting no longer available; preserve artifacts and reconcile'); }
    if (m.id !== a.meetingId) throw Error('Meeting identity changed');
    if (m.state === 'stopped') {
      a.failure = 'Office meeting stopped; inspect its retained notes'; this.save();
      await this.bridge.call('fail', { task_id: a.task.id, token: a.task.claim_token, reason: a.failure });
      await this.io.retire?.(a.meetingId!, a.task.execution_key!);
      a.state = 'done'; return;
    }
    if (m.state === 'done' && m.error) {
      a.failure = m.error; this.save();
      await this.bridge.call('fail', { task_id: a.task.id, token: a.task.claim_token, reason: a.failure });
      await this.io.retire?.(a.meetingId!, a.task.execution_key!); a.state = 'done'; this.save(); return;
    }
    if (m.state === 'done') {
      if (!a.result) { a.result = m.result; if (!a.result) throw Error('Missing routed meeting result'); this.save(); }
      await this.deliver(a);
    }
  }
  private async deliver(a: Attempt) {
    try { await this.bridge.call('complete', { task_id: a.task.id, token: a.task.claim_token, result: a.result }); }
    catch (error) {
      if (!(error instanceof BridgeError) || error.status !== 400) throw error;
      a.failure = 'Middleware rejected completed result: ' + error.message.slice(0, 700); delete a.result; this.save();
      await this.bridge.call('fail', { task_id: a.task.id, token: a.task.claim_token, reason: a.failure });
    }
    await this.io.retire?.(a.meetingId!, a.task.execution_key!); a.state = 'done'; this.save();
  }

}
