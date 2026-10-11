/**
 * Table tennis (ping pong) on the balcony: dimensions, court geometry, physics constants,
 * and game state shared between client and server.
 */

export type PingPongSide = 'west' | 'east';
export type PingPongMode = 'bot' | 'pvp';
export type BotDifficulty = 'easy' | 'normal' | 'pro';

export const PINGPONG_TABLE = {
  x: 6.0,
  y: 0,
  z: 15.0,
  /** Full length along X (meters) */
  length: 2.74,
  /** Full width along Z (meters) */
  width: 1.525,
  /** Table surface height above office floor */
  height: 0.76,
  /** Net height above table surface */
  netHeight: 0.1525,
  /** Table top thickness */
  thickness: 0.04,
} as const;

export const PINGPONG_NET = {
  x: PINGPONG_TABLE.x,
  y0: PINGPONG_TABLE.height,
  y1: PINGPONG_TABLE.height + PINGPONG_TABLE.netHeight,
  minZ: PINGPONG_TABLE.z - PINGPONG_TABLE.width / 2 - 0.08,
  maxZ: PINGPONG_TABLE.z + PINGPONG_TABLE.width / 2 + 0.08,
} as const;

export const PINGPONG_HALVES = {
  west: {
    minX: PINGPONG_TABLE.x - PINGPONG_TABLE.length / 2,
    maxX: PINGPONG_TABLE.x,
    minZ: PINGPONG_TABLE.z - PINGPONG_TABLE.width / 2,
    maxZ: PINGPONG_TABLE.z + PINGPONG_TABLE.width / 2,
  },
  east: {
    minX: PINGPONG_TABLE.x,
    maxX: PINGPONG_TABLE.x + PINGPONG_TABLE.length / 2,
    minZ: PINGPONG_TABLE.z - PINGPONG_TABLE.width / 2,
    maxZ: PINGPONG_TABLE.z + PINGPONG_TABLE.width / 2,
  },
} as const;

/**
 * Where a player stands to play, and which way they face.
 *
 * `rotY` is a body's own heading, the same one a desk's is (see DeskDef): forward is
 * `(sin rotY, cos rotY)`. The west spot is west of the table, so it faces east — `+PI/2`.
 */
export const PINGPONG_SPOTS = {
  west: { x: PINGPONG_TABLE.x - 2.0, y: 0, z: PINGPONG_TABLE.z, rotY: Math.PI / 2 },
  east: { x: PINGPONG_TABLE.x + 2.0, y: 0, z: PINGPONG_TABLE.z, rotY: -Math.PI / 2 },
} as const;

export const PINGPONG_PHYSICS = {
  ballRadius: 0.035,
  gravity: 9.8,
  restitution: 0.86,
  pointsToWin: 11,
  /** How fast a shot leaves the paddle along the table (m/s): the pace a shot is struck at. */
  shotSpeed: 3.4,
  /** How far short of the net a paddle is held, and how high above the table: a ready hand. */
  paddleReach: 1.4,
  paddleHeight: 0.15,
  /** The longest and shortest a shot may be in the air (seconds), so it always clears the net. */
  minFlight: 0.45,
  maxFlight: 1.15,
  /** How close to the table's edge a shot may land (m), so it stays on. */
  edgeMargin: 0.18,
} as const;

/** The other half of the table. */
export function otherSide(side: PingPongSide): PingPongSide {
  return side === 'west' ? 'east' : 'west';
}

/** Which way a body at (x, z) has to turn to face the middle of the table. */
export function facingTable(x: number, z: number): number {
  return Math.atan2(PINGPONG_TABLE.x - x, PINGPONG_TABLE.z - z);
}

/**
 * Where a shot struck by `side` is aimed: a spot inside the far half, kept `edgeMargin` clear of
 * its ends and sides, so a solved shot lands on the table instead of sailing off it.
 * `aim` shifts it along the table's width (`-1..1`) and `depth` (`-1..1`, toward the net or the end).
 */
export function shotTarget(side: PingPongSide, aim = 0, depth = 0, spread = 0): { x: number; z: number } {
  const half = PINGPONG_HALVES[otherSide(side)];
  const inset = PINGPONG_PHYSICS.edgeMargin;
  const lo = Math.min(half.minX, half.maxX) + inset;
  const hi = Math.max(half.minX, half.maxX) - inset;
  const mid = (lo + hi) / 2;
  const reach = (hi - lo) / 2;
  const zLo = Math.min(half.minZ, half.maxZ) + inset;
  const zHi = Math.max(half.minZ, half.maxZ) - inset;
  const zMid = (zLo + zHi) / 2;
  const zReach = (zHi - zLo) / 2;
  const clamp = (v: number, r: number) => Math.max(-1, Math.min(1, v)) * r;
  const toward = otherSide(side) === 'east' ? 1 : -1;
  return {
    x: Math.max(lo, Math.min(hi, mid + toward * clamp(depth, reach) + spread)),
    z: Math.max(zLo, Math.min(zHi, zMid + clamp(aim, zReach))),
  };
}

/**
 * The launch velocity that carries the ball from `from` to `to` (a point on the far half), at about
 * `speed` m/s along the table. Fixed speeds and lifts are what sent every shot off the far end: the
 * arc is solved for the target instead, lengthening the flight until it clears the net.
 */
export function solveShot(from: { x: number; y: number; z: number }, to: { x: number; z: number }, speed: number = PINGPONG_PHYSICS.shotSpeed): PingPongShot {
  const g = PINGPONG_PHYSICS.gravity;
  const landY = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.max(0.2, Math.hypot(dx, dz));
  // The tape, plus the ball's own radius and a little for the net being felt a stride early or late.
  const clear = PINGPONG_TABLE.height + PINGPONG_TABLE.netHeight + PINGPONG_PHYSICS.ballRadius + 0.06;
  let t = Math.max(PINGPONG_PHYSICS.minFlight, Math.min(PINGPONG_PHYSICS.maxFlight, dist / Math.max(0.5, speed)));
  let vx = dx / t;
  let vy = (landY - from.y) / t + 0.5 * g * t;
  // A longer flight is a higher arc over the same target, so keep lengthening until it clears the tape.
  for (let i = 0; i < 24 && t < PINGPONG_PHYSICS.maxFlight; i++) {
    const atNet = Math.abs(vx) < 1e-4 ? Infinity : (PINGPONG_TABLE.x - from.x) / vx;
    const clears = atNet <= 0 || atNet >= t || from.y + vy * atNet - 0.5 * g * atNet * atNet >= clear;
    if (clears) break;
    t = Math.min(PINGPONG_PHYSICS.maxFlight, t * 1.06);
    vx = dx / t;
    vy = (landY - from.y) / t + 0.5 * g * t;
  }
  return { vx, vy, vz: dz / t, t };
}

/**
 * Flies a ball from `from` along `vel` for `seconds`, and says where it first touches down: on the
 * table (`'bounce'` with the point), in the net's band (`'net'`), or past everything (`'floor'`).
 * The one flight model the game and its tests share, so what a test proves is what a player sees.
 */
export function flyBall(
  from: { x: number; y: number; z: number },
  vel: { vx: number; vy: number; vz: number },
  seconds: number,
  step = 1 / 240,
): { where: 'bounce' | 'net' | 'floor' | 'air'; at: { x: number; y: number; z: number }; t: number } {
  const g = PINGPONG_PHYSICS.gravity;
  const top = PINGPONG_TABLE.height;
  const p = { ...from };
  const v = { ...vel };
  for (let t = 0; t < seconds; t += step) {
    v.vy -= g * step;
    p.x += v.vx * step;
    p.y += v.vy * step;
    p.z += v.vz * step;
    if (Math.abs(p.x - PINGPONG_TABLE.x) < 0.05 && p.y >= top && p.y <= top + PINGPONG_TABLE.netHeight && Math.abs(p.z - PINGPONG_TABLE.z) <= PINGPONG_TABLE.width / 2 + 0.1)
      return { where: 'net', at: p, t };
    if (p.y <= top && v.vy < 0) return { where: onTableSurface(p.x, p.z) ? 'bounce' : 'floor', at: p, t };
    if (p.y <= 0) return { where: 'floor', at: p, t };
  }
  return { where: 'air', at: p, t: seconds };
}

export interface PingPongPlayer {
  id: string;
  name: string;
  isBot?: boolean;
  botName?: string;
  difficulty?: BotDifficulty;
}

export interface PingPongBallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}

/** A shot solved by {@link solveShot}: how it leaves the paddle, and how long it is in the air. */
export interface PingPongShot {
  vx: number;
  vy: number;
  vz: number;
  /** Seconds between leaving the paddle and touching the table. */
  t: number;
}

export interface PingPongState {
  active: boolean;
  mode: PingPongMode;
  westPlayer?: PingPongPlayer;
  eastPlayer?: PingPongPlayer;
  score: { west: number; east: number };
  server: PingPongSide;
  rally: number;
  lastHitBy?: PingPongSide;
  lastBounceSide?: PingPongSide;
  winner?: PingPongSide;
  status: 'idle' | 'waiting' | 'serve' | 'rally' | 'point' | 'ended';
  ball?: PingPongBallState;
}

export function defaultPingPongState(): PingPongState {
  return {
    active: false,
    mode: 'bot',
    score: { west: 0, east: 0 },
    server: 'west',
    rally: 0,
    status: 'idle',
  };
}

/** Checks whether a point (x, z) is within the given table half, with optional margin. */
export function inTableHalf(side: PingPongSide, x: number, z: number, margin = 0.04): boolean {
  const h = PINGPONG_HALVES[side];
  return x >= h.minX - margin && x <= h.maxX + margin && z >= h.minZ - margin && z <= h.maxZ + margin;
}

/** Checks whether a point (x, z) is anywhere on the table surface. */
export function onTableSurface(x: number, z: number, margin = 0.04): boolean {
  return inTableHalf('west', x, z, margin) || inTableHalf('east', x, z, margin);
}
