import { flyStep, inTableHalf, onCourtSpot, PINGPONG_COURT, PINGPONG_TABLE, PINGPONG_PHYSICS, tableBounce, type PingPongFlight, type PingPongSide } from '../../../shared/tabletennis';

export const BOT_BAT = { reach: 0.46, height: 1.04, sideways: 0.26 };
/** Find a reachable contact after the legal bounce, rather than waiting for a fixed end plane. */
export function botIntercept(ball: PingPongFlight, side: PingPongSide, bounced = false) {
  const b = { ...ball }, dir = side === 'west' ? 1 : -1, step = 1 / 120;
  for (let t = 0; t < 2; t += step) {
    if (bounced && Math.abs(b.y - BOT_BAT.height) <= 0.42) {
      const feet = onCourtSpot(side, b.x - dir * BOT_BAT.reach, b.z - dir * BOT_BAT.sideways);
      if (Math.hypot(b.x - feet.x - dir * BOT_BAT.reach, b.z - feet.z - dir * BOT_BAT.sideways) < PINGPONG_COURT.lunge * 0.85)
        return { x: b.x, y: b.y, z: b.z, t, feet };
    }
    const before = b.y; flyStep(b, step);
    if (before >= PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius && b.y <= PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius && b.vy < 0 && inTableHalf(side, b.x, b.z)) {
      if (bounced) return null;
      b.y = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius; tableBounce(b); bounced = true;
    }
    if (b.y <= 0) return null;
  }
  return null;
}
