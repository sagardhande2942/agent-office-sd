import { projectMeetingSpaces, rememberedMeetingSpace } from '../../shared/meeting-spaces/state';
import { DEFAULT_MEETING_SPACE } from '../../../shared/meeting-spaces';
import type { MeetingState } from '../../../shared/protocol';
import type { Slice } from '../store';
import { WORKER_VISIBILITY } from '../worker-visibility';
declare module '../store' {
  interface Store { meetingSpaces: MeetingState; selectedMeetingSpace: string }
}
WORKER_VISIBILITY.push((worker, state) => {
  if (!state.meetingSpaces?.spaces) return true;
  const host = worker.helper ? state.workers.get(worker.helper.hostId) : worker;
  return !host?.meeting || host.meeting === state.meeting.current?.id;
});
export const meetingSpaces: Slice = {
  init(s) { s.meetingSpaces = { current: null, past: [] }; s.selectedMeetingSpace = DEFAULT_MEETING_SPACE; },
  on: { meeting(s, msg) { projectMeetingSpaces(s, msg.state); return msg.state.spaces ? ['workers'] : []; } },
  enter(s, view) { projectMeetingSpaces(s, view.meeting, rememberedMeetingSpace(s)); return view.meeting.spaces ? ['workers'] : []; },
};
