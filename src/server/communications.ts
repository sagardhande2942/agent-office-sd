import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { messageStatus, type CommunicationsState, type MessageContext, type WorkerMessage } from '../shared/communications.js';

type Stored = Omit<WorkerMessage, 'status'> & { key?: string };
type Actor = WorkerMessage['from'];
export const MESSAGE_KEEP = 500;
export const MESSAGE_PENDING = 50;

function text(value: unknown, max: number, label: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`${label} must be ${required ? 'nonempty ' : ''}text, at most ${max} characters`);
  return value.trim();
}
export function messageContext(input: unknown): MessageContext {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('context must be an object');
  const c = input as Record<string, unknown>;
  const branch = text(c.branch, 240, 'branch'), commit = text(c.commit, 40, 'commit');
  if (commit && !/^[a-f\d]{7,40}$/i.test(commit)) throw new Error('commit must be a 7-40 character git hash');
  if (c.files !== undefined && (!Array.isArray(c.files) || c.files.length > 20 || c.files.some((f) => typeof f !== 'string' || !f.trim() || f.length > 240))) throw new Error('files must be at most 20 file paths, each at most 240 characters');
  return { ...(branch ? { branch } : {}), ...(commit ? { commit } : {}), ...(c.files !== undefined ? { files: (c.files as string[]).map((f) => f.trim()) } : {}) };
}

/** One floor's bounded, atomic ledger. Reading a worker's inbox is the delivery receipt. */
export class Communications {
  private messages: Stored[] = [];
  private file: string;
  constructor(dir: string, private changed: (state: CommunicationsState) => void = () => {}, private now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'communications.json');
    if (existsSync(this.file)) {
      // Never silently overwrite a damaged ledger and lose conversation history.
      const stored: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(stored) || stored.length > MESSAGE_KEEP || stored.some((m) => !m || typeof m.id !== 'string' || typeof m.threadId !== 'string' || !['request', 'reply'].includes(m.kind) || typeof m.text !== 'string' || typeof m.from?.id !== 'string' || typeof m.from?.name !== 'string' || typeof m.to?.id !== 'string' || typeof m.to?.name !== 'string' || !Number.isFinite(m.at) || !Number.isFinite(m.expiresAt))) throw new Error('Invalid communications ledger');
      for (const m of stored) {
        m.context = messageContext(m.context);
        for (const field of ['deliveredAt', 'acknowledgedAt', 'answeredAt', 'completedAt']) if (m[field] !== undefined && !Number.isFinite(m[field])) throw new Error('Invalid communication receipt');
      }
      if (new Set(stored.map((m) => m.id)).size !== stored.length || stored.some((m) => !stored.some((root) => root.id === m.threadId && root.kind === 'request'))) throw new Error('Invalid communication thread');
      this.messages = stored;
    }
  }
  state(): CommunicationsState {
    return { messages: this.messages.map(({ key: _, ...m }) => structuredClone({ ...m, status: messageStatus(m, this.now()) })) };
  }
  get(id: string): WorkerMessage | undefined { return this.state().messages.find((m) => m.id === id); }
  inbox(actor: Actor): CommunicationsState {
    const next = structuredClone(this.messages);
    let changed = false;
    for (const m of next) if (m.to.id === actor.id && messageStatus(m, this.now()) === 'pending') { m.deliveredAt = this.now(); changed = true; }
    if (changed) this.save(next);
    return { messages: this.state().messages.filter((m) => m.to.id === actor.id || m.from.id === actor.id) };
  }
  request(from: Actor, to: Actor, body: Record<string, unknown>): WorkerMessage {
    if (from.id === to.id) throw new Error('Send a request to another worker');
    return this.create(from, to, body);
  }
  reply(from: Actor, id: string, body: Record<string, unknown>): WorkerMessage {
    const target = this.get(id);
    if (!target || target.kind !== 'request') throw new Error('Reply to a request ID from your inbox');
    if (target.to.id !== from.id) throw new Error('Only the recipient can reply to this request');
    return this.create(from, target.from, body, target);
  }
  acknowledge(actor: Actor, id: string): WorkerMessage {
    const next = structuredClone(this.messages), m = next.find((item) => item.id === id);
    if (!m) throw new Error('Unknown message ID');
    if (m.to.id !== actor.id) throw new Error('Only the recipient can acknowledge this message');
    if (messageStatus(m, this.now()) === 'expired') throw new Error('Message has expired');
    if (m.acknowledgedAt === undefined) {
      m.deliveredAt ??= this.now(); m.acknowledgedAt = this.now();
      if (m.kind === 'reply') {
        const root = next.find((item) => item.id === m.threadId);
        if (root) root.completedAt ??= this.now();
      }
      this.save(next);
    }
    return this.get(id)!;
  }
  private create(from: Actor, to: Actor, body: Record<string, unknown>, target?: WorkerMessage): WorkerMessage {
    const content = text(body.prompt, 4000, 'prompt', true)!;
    const context = messageContext(body.context);
    const key = text(body.key, 80, 'key');
    const minutes = body.ttlMinutes ?? 1440;
    if (!Number.isInteger(minutes) || (minutes as number) < 1 || (minutes as number) > 10080) throw new Error('ttlMinutes must be an integer from 1 to 10080');
    const duplicate = key && this.messages.find((m) => m.from.id === from.id && m.key === key);
    if (duplicate) {
      if (duplicate.to.id !== to.id || duplicate.text !== content || duplicate.replyTo !== target?.id || duplicate.expiresAt - duplicate.at !== (minutes as number) * 60_000 || JSON.stringify(duplicate.context) !== JSON.stringify(context)) throw new Error('Idempotency key already used for a different message');
      return this.get(duplicate.id)!;
    }
    if (target && (target.status === 'expired' || target.status === 'completed')) throw new Error(`Request is ${target.status}`);
    if (this.messages.filter((m) => m.from.id === from.id && ['pending', 'delivered', 'acknowledged', 'answered'].includes(messageStatus(m, this.now())) && m.kind === 'request').length >= MESSAGE_PENDING) throw new Error('Too many unresolved requests (50); wait for replies or expiration');
    const next = structuredClone(this.messages);
    // Evict complete or expired threads as units; never discard an unresolved request's replies.
    while (next.length >= MESSAGE_KEEP) {
      const root = next.find((m) => m.kind === 'request' && ['completed', 'expired'].includes(messageStatus(m, this.now())));
      if (!root) throw new Error('Communication history is full; complete existing threads first');
      for (let i = next.length - 1; i >= 0; i--) if (next[i].threadId === root.id) next.splice(i, 1);
    }
    const id = randomUUID(), at = this.now();
    const m: Stored = { id, threadId: target?.threadId ?? id, ...(target ? { replyTo: target.id } : {}), kind: target ? 'reply' : 'request', from: { ...from }, to: { ...to }, text: content, context, at, expiresAt: at + (minutes as number) * 60_000, ...(key ? { key } : {}) };
    if (target) {
      const root = next.find((item) => item.id === target.threadId)!;
      root.deliveredAt ??= at; root.answeredAt ??= at;
    }
    next.push(m); this.save(next);
    return this.get(id)!;
  }
  private save(next: Stored[]) {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); renameSync(temp, this.file);
    this.messages = next; this.changed(this.state());
  }
}
