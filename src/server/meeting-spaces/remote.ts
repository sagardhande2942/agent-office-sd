import type { FloorMeetings } from '../floor-actions.js';
import type { MeetingRequest, MeetingState } from '../../shared/protocol.js';
/** Only commands cross the wire; state remains the host's live snapshot. */
export class RemoteMeetings implements FloorMeetings {
  constructor(private call: (t: string, body: Record<string, unknown>) => Promise<unknown>, private supported: () => boolean, private snapshot: () => MeetingState) {}
  private async command(t: string, body: Record<string, unknown>): Promise<string | undefined> {
    if (!this.supported()) return 'Update the floor host to support meeting spaces';
    const result = await this.call(t, body);
    return typeof result === 'string' ? result : undefined;
  }
  create(name: unknown) { return this.command('meeting-space.create', { name }); }
  rename(id: string, name: unknown) { return this.command('meeting-space.rename', { id, name }); }
  start(req: MeetingRequest, by: string, owner?: string, capacity?: { room: number | null; paused?: string }) { return this.command('meeting.start', { req, by, owner, capacity }); }
  stop(by: string, spaceId?: string) { return this.command('meeting.stop', { by, spaceId }); }
  clear(by: string, spaceId?: string) { return this.command('meeting.clear', { by, spaceId }); }
  finishAnyway(id: string, by: string) { return this.command('meeting.finish', { id, by, allowUnresolved: true }); }
  state() { return this.snapshot(); }
}
