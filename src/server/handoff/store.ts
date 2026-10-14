import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HandoffActor, HandoffPacket } from '../../shared/handoff.js';
import type { Communications } from '../communications.js';
import { checks, context, strings, text } from './validation.js';
export type Offer = Omit<HandoffPacket, 'id' | 'state' | 'offeredAt' | 'acceptedAt' | 'cancelledAt' | 'continuationOwner' | 'messageId' | 'receipt'>;
type Stored = HandoffPacket & { fingerprint: string };
/** Atomic per-floor ledger. Inbox delivery is a retryable outbox, never acceptance. */
export class HandoffStore {
  private packets: Stored[] = [];
  private file: string;
  constructor(dir: string, readonly floorId: string, private ledger: Communications, private now = Date.now) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); this.file = path.join(dir, 'handoffs.json');
    if (existsSync(this.file)) {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data) || data.length > 1000) throw Error('Invalid handoff ledger');
      for (const p of data) {
        if (p.floorId !== floorId || !['offered', 'accepted', 'cancelled'].includes(p.state) || !Number.isFinite(p.offeredAt) || !Number.isInteger(p.task?.revision) || p.task.revision < 0 || p.evidence !== 'worker-reported') throw Error('Invalid handoff ledger');
        for (const a of [p.source, p.recipient]) { text(a?.id, 'participant ID', 80); text(a?.name, 'participant name', 100); }
        text(p.id, 'id', 80); text(p.key, 'key', 80); text(p.fingerprint, 'fingerprint', 64); text(p.task.id, 'task ID', 200); text(p.task.goal, 'goal'); text(p.completedWork, 'completed work'); text(p.nextSteps, 'next steps');
        strings(p.files, 'files', 100, 500); strings(p.questions, 'questions', 30, 2000); checks(p.checks); context(p.context);
        if (!p.files.length) text(p.filesNote, 'filesNote'); if (!p.questions.length) text(p.questionsNote, 'questionsNote');
        if (p.state === 'accepted' && (!Number.isFinite(p.acceptedAt) || p.continuationOwner?.id !== p.recipient.id)) throw Error('Invalid acceptance');
        if (p.state === 'cancelled' && !Number.isFinite(p.cancelledAt)) throw Error('Invalid cancellation');
      }
      if (new Set(data.map(p => p.id)).size !== data.length || new Set(data.map(p => `${p.source.id}:${p.key}`)).size !== data.length) throw Error('Duplicate handoff ledger IDs');
      this.packets = data;
    }
  }
  list(): HandoffPacket[] { return this.packets.map(p => this.view(p)); }
  read(id: string): HandoffPacket { const p = this.packets.find(p => p.id === id); if (!p) throw Error('Unknown handoff on this floor'); return this.view(p); }
  retry(source: string, key: string, body: unknown): HandoffPacket | undefined {
    const p = this.packets.find(p => p.source.id === source && p.key === key);
    if (!p) return;
    if (p.fingerprint !== this.fingerprint(body)) throw Error('Idempotency key already used for a different handoff');
    return this.deliver(p.id);
  }
  offer(packet: Offer, body: unknown): HandoffPacket {
    const duplicate = this.retry(packet.source.id, packet.key, body); if (duplicate) return duplicate;
    if (this.packets.length >= 1000) throw Error('Handoff storage is full; packets have been retained');
    const p: Stored = { ...structuredClone(packet), id: randomUUID(), state: 'offered', offeredAt: this.now(), fingerprint: this.fingerprint(body) };
    this.save([...this.packets, p]); return this.deliver(p.id);
  }
  accept(id: string, actor: HandoffActor): HandoffPacket {
    const p = this.read(id);
    if (p.recipient.id !== actor.id) throw Error('Only the named recipient can accept this handoff');
    if (p.state === 'cancelled') throw Error('Handoff was cancelled');
    if (p.state === 'accepted') return p;
    const next = structuredClone(this.packets), entry = next.find(p => p.id === id)!;
    entry.state = 'accepted'; entry.acceptedAt = this.now(); entry.continuationOwner = { ...actor };
    this.save(next); return this.read(id);
  }
  cancel(id: string, actor: HandoffActor): HandoffPacket {
    const p = this.read(id);
    if (p.source.id !== actor.id) throw Error('Only the source can cancel this handoff');
    if (p.state === 'accepted') throw Error('Accepted handoffs cannot be cancelled');
    if (p.state === 'cancelled') return p;
    const next = structuredClone(this.packets), entry = next.find(p => p.id === id)!;
    entry.state = 'cancelled'; entry.cancelledAt = this.now(); this.save(next); return this.read(id);
  }
  private deliver(id: string): HandoffPacket {
    const p = this.packets.find(p => p.id === id)!;
    if (!p.messageId && p.state === 'offered') {
      const message = this.ledger.request(p.source, p.recipient, { key: `handoff:${id}`, prompt: `Handoff offered: ${id}\nGoal: ${p.task.goal.slice(0, 2000)}\nRead the full durable packet with handoff_read / office-workers handoff read ${id}. Explicitly accept with handoff_accept / office-workers handoff accept ${id}. Inbox receipt is not acceptance. Work remains at ${p.context.worktree ?? 'the source checkout'} on ${p.context.branch ?? 'the recorded source branch'}. Acceptance does not replace your task or move files.`, context: { ...(p.context.branch ? { branch: p.context.branch } : {}), ...(p.context.commit ? { commit: p.context.commit } : {}) } });
      const next = structuredClone(this.packets); next.find(p => p.id === id)!.messageId = message.id; this.save(next);
    }
    return this.read(id);
  }
  private view(p: Stored): HandoffPacket { const { fingerprint: _, ...packet } = structuredClone(p); return { ...packet, ...(p.messageId ? { receipt: this.ledger.get(p.messageId) } : {}) }; }
  private fingerprint(body: unknown) { const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex'); }
  private save(next: Stored[]) { writeFileSync(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 }); renameSync(`${this.file}.tmp`, this.file); this.packets = next; }
}
