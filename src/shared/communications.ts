/** Tracked coordination is separate from terminal output and never types into a worker. */
export type MessageStatus = 'pending' | 'delivered' | 'acknowledged' | 'answered' | 'completed' | 'expired';
export interface MessageContext { branch?: string; commit?: string; files?: string[] }
export interface WorkerMessage {
  id: string;
  threadId: string;
  replyTo?: string;
  kind: 'request' | 'reply';
  /** Helper reports use acknowledgment as completion; they need no reply to the departed helper. */
  helperReport?: { workerId: string; handledVia?: 'inbox' | 'terminal'; terminalClaimed?: boolean };
  from: { id: string; name: string };
  to: { id: string; name: string };
  text: string;
  context: MessageContext;
  /** Assigned by the office to requests from meeting participants; replies inherit it. */
  meeting?: { id: string; round: number };
  at: number;
  expiresAt: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
  answeredAt?: number;
  completedAt?: number;
  status: MessageStatus;
}
export interface CommunicationsState { messages: WorkerMessage[]; error?: string }
export function messageStatus(message: Omit<WorkerMessage, 'status'>, now = Date.now()): MessageStatus {
  if (message.completedAt !== undefined) return 'completed';
  if (message.kind === 'reply' && message.acknowledgedAt !== undefined) return 'acknowledged';
  if (message.expiresAt <= now) return 'expired';
  if (message.answeredAt !== undefined) return 'answered';
  if (message.acknowledgedAt !== undefined) return 'acknowledged';
  return message.deliveredAt !== undefined ? 'delivered' : 'pending';
}
export function contextLabel(context: MessageContext): string {
  return [context.branch && `branch: ${context.branch}`, context.commit && `commit: ${context.commit}`, context.files?.length && `files: ${context.files.join(', ')}`].filter(Boolean).join(' · ');
}

/** Threads explicitly linked to a meeting, including handoffs to workers outside its table. */
export function meetingMessages(messages: WorkerMessage[], id: string): WorkerMessage[] {
  return messages.filter((m) => m.meeting?.id === id);
}
export function unresolvedRequests(messages: WorkerMessage[]): WorkerMessage[] {
  return messages.filter((m) => m.kind === 'request' && !['completed', 'expired'].includes(m.status));
}
