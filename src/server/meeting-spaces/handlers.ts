import type { MeetingSpaceClientMsg } from '../../shared/meeting-spaces.js';
import type { HandlerMap } from '../ws/handlers/types.js';
import { here } from '../ws/handlers/common.js';
import { str } from '../office/input.js';
export const meetingSpaceHandlers = {
  'meeting-space.create'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    const local = ctx.asLocal(floor);
    ctx.warn(c, local ? local.meetings.create(msg.name) : 'Meeting spaces currently require a local floor');
  },
  'meeting-space.rename'(ctx, c, msg) {
    const floor = here(ctx, c); if (!floor) return;
    const local = ctx.asLocal(floor);
    ctx.warn(c, local ? local.meetings.rename(str(msg.id, 80), msg.name) : 'Meeting spaces currently require a local floor');
  },
} satisfies HandlerMap<MeetingSpaceClientMsg>;
