import { DEFAULT_MEETING_SPACE, meetingSpaceState } from '../../../shared/meeting-spaces';
import type { MeetingState } from '../../../shared/protocol';
import type { Store } from '../../state/store';
const key = (s: Store) => `agent-office.meeting-space.${s.floor ?? 'none'}`;
export function rememberedMeetingSpace(s: Store) {
  try { return localStorage.getItem(key(s)) ?? DEFAULT_MEETING_SPACE; } catch { return DEFAULT_MEETING_SPACE; }
}
export function projectMeetingSpaces(s: Store, state: MeetingState, id = s.selectedMeetingSpace) {
  s.meetingSpaces = state;
  s.selectedMeetingSpace = state.spaces?.find(space => space.id === id)?.id ?? state.spaces?.[0]?.id ?? DEFAULT_MEETING_SPACE;
  s.meeting = meetingSpaceState(state, s.selectedMeetingSpace);
}
export function selectMeetingSpace(s: Store, id: string) {
  if (!s.meetingSpaces.spaces?.some(space => space.id === id)) return;
  projectMeetingSpaces(s, s.meetingSpaces, id);
  try { localStorage.setItem(key(s), id); } catch { /* private storage can be disabled */ }
  s.emit('meeting'); s.emit('workers');
}
