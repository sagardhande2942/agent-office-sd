import { PINGPONG_PHYSICS, PINGPONG_SPIN, PINGPONG_STROKES, PINGPONG_TABLE, type PingPongFlight, type PingPongShot, type PingPongShotKind } from './tabletennis.js';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Displacement caused by exponentially decaying spin; shared by solver and flight. */
function spinIntegral(t: number) {
  const k = PINGPONG_SPIN.bleed;
  return t / k - (1 - Math.exp(-k * t)) / (k * k);
}
/** Exact flight integration prevents frame rate from changing spin or landing position. */
export function flyStep(b: PingPongFlight, dt: number) {
  const decay = Math.exp(-PINGPONG_SPIN.bleed * dt);
  const impulse = (1 - decay) / PINGPONG_SPIN.bleed;
  b.x += b.vx * dt;
  b.y += b.vy * dt - 0.5 * PINGPONG_PHYSICS.gravity * dt * dt - PINGPONG_SPIN.magnus * b.tops * spinIntegral(dt);
  b.z += b.vz * dt + PINGPONG_SPIN.drift * b.side * spinIntegral(dt);
  b.vy -= PINGPONG_PHYSICS.gravity * dt + PINGPONG_SPIN.magnus * b.tops * impulse;
  b.vz += PINGPONG_SPIN.drift * b.side * impulse;
  b.tops *= decay; b.side *= decay;
}
/** Solve a landing point using the very same decaying-spin model as flyStep. */
export function solveShot(from: { x: number; y: number; z: number }, to: { x: number; z: number }, kind: PingPongShotKind = 'drive', power = 0.5, sidespin = 0): PingPongShot {
  const stroke = PINGPONG_STROKES[kind], tops = stroke.tops, side = clamp(sidespin, -1.5, 1.5);
  const dx = to.x - from.x, dz = to.z - from.z;
  const speed = Math.min(7.5, stroke.speed * (0.55 + clamp(power, 0, 1) * 0.9));
  const landY = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius;
  let t = clamp(Math.hypot(dx, dz) / speed, 0.2, 1.4);
  const launchY = (time: number) => (landY - from.y + 0.5 * PINGPONG_PHYSICS.gravity * time * time + PINGPONG_SPIN.magnus * tops * spinIntegral(time)) / time;
  // A low contact needs lift to clear the net. Higher contacts retain a faster, flatter shot.
  const fraction = dx ? (PINGPONG_TABLE.x - from.x) / dx : -1;
  for (let i = 0; i < 50 && fraction > 0 && fraction < 1; i++) {
    const n = t * fraction;
    const y = from.y + launchY(t) * n - 0.5 * PINGPONG_PHYSICS.gravity * n * n - PINGPONG_SPIN.magnus * tops * spinIntegral(n);
    if (y >= PINGPONG_TABLE.height + PINGPONG_TABLE.netHeight + PINGPONG_PHYSICS.ballRadius + 0.025 || t >= 1.4) break;
    t = Math.min(1.4, t * 1.025);
  }
  return { vx: dx / t, vy: launchY(t), vz: (dz - PINGPONG_SPIN.drift * side * spinIntegral(t)) / t, t, kind, tops, side };
}
/** Sweep the whole segment across the net, including the ball's radius. */
export function netContact(before: { x: number; y: number; z: number }, after: { x: number; y: number; z: number }) {
  const radius = PINGPONG_PHYSICS.ballRadius, plane = PINGPONG_TABLE.x - Math.sign(after.x - before.x) * radius;
  const t = (plane - before.x) / (after.x - before.x);
  if (!Number.isFinite(t) || t < 0 || t > 1) return false;
  const y = before.y + (after.y - before.y) * t, z = before.z + (after.z - before.z) * t;
  return y >= PINGPONG_TABLE.height - radius && y <= PINGPONG_TABLE.height + PINGPONG_TABLE.netHeight + radius && Math.abs(z - PINGPONG_TABLE.z) <= PINGPONG_TABLE.width / 2 + 0.08 + radius;
}
