import type { MeetingSpaceClientMsg } from '../../shared/meeting-spaces.js';
import type { HandlerMap } from '../ws/handlers/types.js';
import { here } from '../ws/handlers/common.js';
import { str } from '../office/input.js';
export const meetingSpaceHandlers = {
  async 'meeting-space.create'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    ctx.warn(c, await floor.meetings.create(msg.name));
  },
  async 'meeting-space.rename'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    ctx.warn(c, await floor.meetings.rename(str(msg.id, 80), msg.name));
  },
} satisfies HandlerMap<MeetingSpaceClientMsg>;
