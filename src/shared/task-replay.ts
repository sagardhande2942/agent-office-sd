/** Structured evidence only: never terminal streams or executable actions. */
export type ReplayEventType = 'start' | 'plan' | 'assignment' | 'result' | 'blocker' | 'retry' | 'review' | 'integration' | 'pause' | 'resume' | 'stop' | 'final-pr';
export interface ReplayDetails {
  instructions?: string;
  message?: string;
  evidence?: string;
  reviewReason?: string;
  commits?: string[];
  reportedChecks?: string;
  verifiedChecks?: string;
  pr?: string;
  missing?: string[];
}
export interface ReplayEvent {
  id: string;
  timestamp: number;
  activityId: string;
  type: ReplayEventType;
  participantId?: string;
  taskId?: string;
  summary: string;
  details: ReplayDetails;
}
export interface ReplayLog {
  events: ReplayEvent[];
  dropped: number;
  historical?: boolean;
}
export const REPLAY_EVENT_LIMIT = 500;
export const REPLAY_TEXT_LIMIT = 4000;
