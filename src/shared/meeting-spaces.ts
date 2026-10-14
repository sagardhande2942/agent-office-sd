import type { Meeting, MeetingRecord, MeetingState, WorkerInfo } from './protocol.js';
export const DEFAULT_MEETING_SPACE = 'main';
export const MEETING_SPACE_LIMIT = 16;
export interface MeetingSpace {
  id: string;
  name: string;
  createdAt: number;
  current: Meeting | null;
  past: MeetingRecord[];
}
export type MeetingSpaceClientMsg =
  | { t: 'meeting-space.create'; name: string }
  | { t: 'meeting-space.rename'; id: string; name: string };
export function spaceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= 60 && !/[\x00-\x1f\x7f]/.test(name) ? name : undefined;
}
export function meetingSpaceState(state: MeetingState, id: string): MeetingState {
  const space = state.spaces?.find(s => s.id === id) ?? state.spaces?.[0];
  return space ? { current: space.current, past: space.past, spaces: state.spaces } : state;
}
export function participantMeeting(state: MeetingState, ...ids: string[]): Meeting | undefined {
  const meetings = state.spaces ? state.spaces.map(s => s.current) : [state.current];
  for (const id of ids) {
    const meeting = meetings.find(m => m?.status === 'running' && m.seats.some(s => s.workerId === id));
    if (meeting) return meeting;
  }
  return undefined;
}
export function spaceStatus(space: MeetingSpace, workers: Iterable<WorkerInfo>): string {
  const m = space.current;
  if (!m) return 'Ready';
  if (m.status !== 'running') return m.status === 'done' ? 'Done' : 'Stopped';
  if (m.waitingForCommunications || m.coordinationError || [...workers].some(w => w.meeting === m.id && ['needs_input', 'offline', 'exited'].includes(w.status))) return 'Needs attention';
  return 'Working';
}
