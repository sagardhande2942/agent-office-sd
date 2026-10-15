import type { MeetingClientMsg } from '../../shared/protocol';
import type { Net } from '../net';
export interface MeetingWindowExtension {
  mount(net: Net, switched: () => void): { element: HTMLElement; refresh(): void; dispose?(): void };
  command?(msg: MeetingClientMsg): MeetingClientMsg;
}
export const MEETING_WINDOW_EXTENSIONS: MeetingWindowExtension[] = [];
export function meetingCommand(msg: MeetingClientMsg): MeetingClientMsg {
  return MEETING_WINDOW_EXTENSIONS.reduce((command, extension) => extension.command?.(command) ?? command, msg);
}
