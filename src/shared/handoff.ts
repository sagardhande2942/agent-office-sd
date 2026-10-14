import type { CompletionCheck } from './completion.js';
import type { WorkerMessage } from './communications.js';
export interface HandoffActor { id: string; name: string }
export interface HandoffContext { branch?: string; commit?: string; pr?: string; worktree?: string }
/** Immutable task evidence, reported by its source worker rather than independently verified. */
export interface HandoffPacket {
  id: string; floorId: string; key: string;
  source: HandoffActor; recipient: HandoffActor;
  task: { id: string; revision: number; goal: string };
  completedWork: string; nextSteps: string;
  files: string[]; filesNote?: string;
  checks: CompletionCheck[];
  questions: string[]; questionsNote?: string;
  context: HandoffContext;
  evidence: 'worker-reported';
  state: 'offered' | 'accepted' | 'cancelled';
  offeredAt: number; acceptedAt?: number; cancelledAt?: number;
  continuationOwner?: HandoffActor;
  messageId?: string; receipt?: WorkerMessage;
}
