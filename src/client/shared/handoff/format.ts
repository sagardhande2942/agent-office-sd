import type { CompletionCheck } from '../../../shared/completion';
import { contextLabel, type WorkerMessage } from '../../../shared/communications';
import type { HandoffPacket } from '../../../shared/handoff';

// What the station's window says about a packet, kept apart from the window itself so the office, Lite
// and the tests all read a packet's evidence and promises the same way.

export type HandoffActor = HandoffPacket['source'];
export type HandoffState = HandoffPacket['state'];
export type HandoffContext = HandoffPacket['context'];

export const HANDOFF_STATE_LABEL: Record<HandoffState, string> = {
  offered: 'Offered',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
};

/** What a packet is, said where its evidence is read rather than only in the docs. */
export const HANDOFF_EVIDENCE_NOTE =
  'Every packet is worker-reported: the office stores what the source worker submitted and does not re-run its checks. A passed check is reported evidence, not independent verification.';

/** What reading this window can and cannot do, said next to the packets it shows. */
export const HANDOFF_ACCEPTANCE_NOTE =
  'Only the named recipient worker can accept a packet, through its own authenticated office tools; nothing in this window accepts one, and viewing it does not record acceptance. Acceptance records the continuation owner and timestamp: it does not move files, reset a worktree, replace or complete the source task, or apply changes. It also does not replace the recipient\'s own current task — that worker decides when to continue from it. The work remains in the recorded source checkout — read the branch and worktree, reconcile current assignments at a safe checkpoint, and preserve needed commits before the source departs.';

export function stateLabel(state: HandoffState): string {
  return HANDOFF_STATE_LABEL[state] ?? state;
}

/** The source task the packet was taken from, with the revision it stood at. */
export function taskLabel(packet: HandoffPacket): string {
  return `${packet.task.id} @ revision ${packet.task.revision}`;
}

/** The branch, commit, pull request and worktree the packet recorded, as one line. */
export function contextLine(context: HandoffContext): string {
  const parts = [
    context.branch && `branch ${context.branch}`,
    context.commit && `commit ${context.commit}`,
    context.pr && `pull request ${context.pr}`,
    context.worktree && `worktree ${context.worktree}`,
  ];
  return parts.filter(Boolean).join(' · ') || 'No branch, commit, pull request or worktree was recorded.';
}

/** How the checks came out, before the list of them. */
export function checksSummary(checks: readonly CompletionCheck[]): string {
  if (!checks.length) return 'No checks were recorded.';
  const count = (status: CompletionCheck['status']) => checks.filter((c) => c.status === status).length;
  return `${checks.length} recorded · ${count('passed')} passed · ${count('failed')} failed · ${count('skipped')} skipped`;
}

/** The files changed, or the source worker's own note saying there are none. */
export function filesLine(files: readonly string[], filesNote?: string): string {
  if (files.length) return files.join(', ');
  return filesNote?.trim() ? filesNote : 'No changed files were recorded, and no note explained why.';
}

/** How the unresolved questions read: the count, or the source worker's explicit note saying there are none. */
export function questionsLine(questions: readonly string[], questionsNote?: string): string {
  if (questions.length) return `${questions.length} unresolved question${questions.length === 1 ? '' : 's'}`;
  return questionsNote?.trim() ? questionsNote : 'None recorded.';
}

/** The tracked inbox message that carried the packet, and how far its receipt got. */
export function receiptLine(receipt?: WorkerMessage): string {
  if (!receipt) return 'No tracked inbox receipt was recorded for this packet.';
  const context = contextLabel(receipt.context);
  return `${receipt.kind} · ${receipt.status} · ${receipt.from.name} → ${receipt.to.name} · sent ${new Date(receipt.at).toLocaleString()}${context ? ` · ${context}` : ''}`;
}

/** The one line an observer browses a packet by. */
export function packetHeadline(packet: HandoffPacket): string {
  return `${packet.source.name} → ${packet.recipient.name}: ${packet.task.goal}`;
}

/**
 * Who a packet names: its source, its recipient, and whoever took it on. Source and recipient can be
 * the same person only on a re-offered packet, which the map keeps to one entry.
 */
export function packetActors(packet: HandoffPacket): HandoffActor[] {
  const seen = new Map<string, HandoffActor>();
  for (const actor of [packet.source, packet.recipient, packet.continuationOwner]) if (actor) seen.set(actor.id, actor);
  return [...seen.values()];
}
