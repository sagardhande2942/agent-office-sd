import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { FloorActions } from '../floor-actions.js';
import type { MeetingRequest } from '../../shared/protocol.js';
import { isMeetingPattern, MEETING_PATTERNS } from '../../shared/meetings.js';
const reserved = new WeakMap<Ctx, number>();
/** Remote agents use host sign-ins; reserve the office's capacity until its roster arrives. */
export function startMeeting(ctx: Ctx, c: Client, floor: FloorActions, request: MeetingRequest, by: string) {
  const remote = ctx.remoteFloors.get(floor.id);
  if (!remote) {
    ctx.withSignIn(c, ctx.claudeFor(request.provider ?? floor.workers.officeDefault.provider), () => ctx.withFreshBase(c, floor, async () => ctx.warn(c, await floor.meetings.start(request, by, c.accountId))));
    return;
  }
  if (!isMeetingPattern(request.pattern)) return ctx.warn(c, 'Unknown meeting pattern');
  const seats = request.roles?.length || MEETING_PATTERNS[request.pattern].seats.default;
  const room = ctx.machine.room() - (reserved.get(ctx) ?? 0);
  if (ctx.ledger.hiringPaused) return ctx.warn(c, ctx.ledger.hiringPaused);
  if (room < seats) return ctx.warn(c, `The office needs room for ${seats} meeting workers; send workers home first`);
  reserved.set(ctx, (reserved.get(ctx) ?? 0) + seats);
  void remote.meetings.start(request, by, c.accountId, { room: Number.isFinite(room) ? room : null }).then(error => ctx.warn(c, error)).finally(() => reserved.set(ctx, (reserved.get(ctx) ?? 0) - seats));
}
