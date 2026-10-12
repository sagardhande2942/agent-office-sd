import { flyStep, netContact } from './tabletennis-ballistics.js';
export { flyStep, solveShot, solveServe } from './tabletennis-ballistics.js';
/**
 * Table tennis (ping pong) on the balcony: dimensions, court geometry, physics constants,
 * and game state shared between client and server.
 */

export type PingPongSide = 'west' | 'east';
export type PingPongMode = 'bot' | 'pvp' | 'bots';
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
  ballRadius: 0.02,
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

/**
 * The ground a player covers at their own end of the table: a stride either side of their spot and
 * a pace back from it, so you have to walk to the ball rather than covering the table from one spot.
 */
export const PINGPONG_COURT = {
  /** How far either side of your spot (along the table) you may walk. */
  across: 1.15,
  /** How far in front of your spot, towards the table, and behind it, you may go. */
  forward: 0.45,
  back: 0.5,
  /** How fast you shuffle along it (m/s), and how long a struck ball leaves you recovering (s). */
  pace: 2.6,
  recovery: 0.45,
  /** How far your bat reaches from your body to play a ball (m). */
  lunge: 0.95,
} as const;

/** Whether (x, z) is somewhere `side` can stand and play from. */
export function onCourt(side: PingPongSide, x: number, z: number): boolean {
  const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
  const dir = side === 'west' ? 1 : -1;
  const back = -dir * PINGPONG_COURT.back;
  const forward = dir * PINGPONG_COURT.forward;
  return x >= Math.min(spot.x + back, spot.x + forward) && x <= Math.max(spot.x + back, spot.x + forward) && Math.abs(z - spot.z) <= PINGPONG_COURT.across;
}

/** Keeps a player on their own end of the table, and returns where they end up. */
export function onCourtSpot(side: PingPongSide, x: number, z: number): { x: number; z: number } {
  const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
  const dir = side === 'west' ? 1 : -1;
  const lo = spot.x - dir * PINGPONG_COURT.back;
  const hi = spot.x + dir * PINGPONG_COURT.forward;
  return {
    x: Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), x)),
    z: Math.max(spot.z - PINGPONG_COURT.across, Math.min(spot.z + PINGPONG_COURT.across, z)),
  };
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

/** The four ways to strike the ball, from a flat drive to a smash. */
export type PingPongShotKind = 'drive' | 'topspin' | 'backspin' | 'smash';

/**
 * What each stroke is: how fast it leaves the bat (m/s along the table), how much spin it carries
 * (`tops`, positive over the ball and negative under it) and how much it pulls across the table
 * (`side`). A smash is flat and fast, a topspin loop dips and kicks on, a backspin returns floaty
 * and skids, a drive is somewhere between the loop and the smash.
 */
export const PINGPONG_STROKES: Record<PingPongShotKind, { speed: number; tops: number; side: number; label: string }> = {
  drive: { speed: 3.9, tops: 0.35, side: 0, label: 'Drive' },
  topspin: { speed: 3.2, tops: 1.7, side: 0, label: 'Topspin' },
  backspin: { speed: 2.7, tops: -1.3, side: 0, label: 'Backspin' },
  smash: { speed: 6.2, tops: 0.7, side: 0, label: 'Smash' },
};

/** What the spin does to a ball in flight and off the table. */
export const PINGPONG_SPIN = {
  /** How hard a full spin pulls the ball down (m/s² per unit of `tops`): a loop dips, a chop floats. */
  magnus: 1.5,
  /** How much a side spin walks the ball across the table while it is in the air (m/s² per unit). */
  drift: 1.1,
  /** The rebound: a topped ball kicks up and on, a cut one skids and dies. */
  kick: 1.22,
  skid: 0.74,
  /** And how much each does to the pace off the bat. */
  kickPace: 1.08,
  skidPace: 0.93,
  /** Spin is bled off as the ball flies, so a long rally settles down. */
  bleed: 0.55,
} as const;

/** The player swapping stroke while the ball is away. */
export const PINGPONG_STROKES_ORDER: PingPongShotKind[] = ['drive', 'topspin', 'backspin', 'smash'];

/** A ball in flight, with the spin it is carrying. */
export interface PingPongFlight {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  tops: number;
  side: number;
}

/** What the table does to a ball coming off it: a topped one kicks up and carries on, a cut one skids. */
export function tableBounce(b: PingPongFlight) {
  const spin = Math.min(1, Math.abs(b.tops) / 1.7);
  const lift = b.tops >= 0 ? 1 + (PINGPONG_SPIN.kick - 1) * spin : 1 + (PINGPONG_SPIN.skid - 1) * spin;
  const pace = b.tops >= 0 ? 1 + (PINGPONG_SPIN.kickPace - 1) * spin : 1 + (PINGPONG_SPIN.skidPace - 1) * spin;
  b.vy = -b.vy * PINGPONG_PHYSICS.restitution * lift;
  b.vx *= pace;
  // The spin goes into the table: a topped ball squirts on, a cut ball comes off with less of it.
  b.tops *= b.tops >= 0 ? 0.55 : 1.25;
}

/**
 * Flies a ball from `from` along `vel` for `seconds`, and says where it first touches down: on the
 * table (`'bounce'` with the point), in the net's band (`'net'`), or past everything (`'floor'`).
 */
export function flyBall(
  from: { x: number; y: number; z: number },
  vel: { vx: number; vy: number; vz: number },
  seconds: number,
  spin?: { tops: number; side: number },
  step = 1 / 240,
): { where: 'bounce' | 'net' | 'floor' | 'air'; at: { x: number; y: number; z: number }; t: number } {
  const top = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius;
  const b: PingPongFlight = { ...from, ...vel, tops: spin?.tops ?? 0, side: spin?.side ?? 0 };
  for (let t = 0; t < seconds; t += step) {
    const before = { x: b.x, y: b.y, z: b.z };
    flyStep(b, step);
    if (netContact(before, b))
      return { where: 'net', at: b, t };
    if (b.y <= top && b.vy < 0) return { where: onTableSurface(b.x, b.z) ? 'bounce' : 'floor', at: b, t };
    if (b.y <= 0) return { where: 'floor', at: b, t };
  }
  return { where: 'air', at: b, t: seconds };
}

/**
 * Where and when a ball in flight crosses the plane in front of the bat held by `side`: the shot it
 * can be played from. `null` when it never gets there (already past, or out of the room).
 */
export function meetPoint(b: PingPongFlight, side: PingPongSide, seconds = 2): { x: number; y: number; z: number; t: number } | null {
  const plane = side === 'west' ? PINGPONG_TABLE.x - PINGPONG_PHYSICS.paddleReach : PINGPONG_TABLE.x + PINGPONG_PHYSICS.paddleReach;
  const step = 1 / 120;
  const walked: PingPongFlight = { ...b };
  for (let t = 0; t < seconds; t += step) {
    const before = Math.sign(walked.x - plane);
    flyStep(walked, step);
    if (before !== 0 && Math.sign(walked.x - plane) !== before) return { x: plane, y: walked.y, z: walked.z, t };
    // It bounces on the way, exactly as the game will bounce it.
    if (walked.y <= PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius && walked.vy < 0 && onTableSurface(walked.x, walked.z)) {
      walked.y = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius;
      tableBounce(walked);
    }
    if (walked.y <= 0) return null;
  }
  return null;
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
  /** The spin it is carrying: over the ball (positive) or under it, and across it. */
  tops: number;
  side: number;
  /** The stroke it was last struck with. */
  kind: PingPongShotKind;
  t: number;
}

/** A shot solved by {@link solveShot}: how it leaves the bat, what spin it carries, how long it flies. */
export interface PingPongShot {
  vx: number;
  vy: number;
  vz: number;
  /** Seconds between leaving the bat and touching the table. */
  t: number;
  kind: PingPongShotKind;
  /** Spin over the ball (positive) or under it (negative), and across it. */
  tops: number;
  side: number;
}

export interface PingPongState {
  active: boolean;
  mode: PingPongMode;
  /** The client running a bot exhibition; watchers cannot submit its shots or scores. */
  operatorId?: string;
  watcherIds?: string[];
  westPlayer?: PingPongPlayer;
  eastPlayer?: PingPongPlayer;
  score: { west: number; east: number };
  /** Games won, of `PINGPONG_MATCH.games` to win the match. */
  games: { west: number; east: number };
  server: PingPongSide;
  rally: number;
  lastHitBy?: PingPongSide;
  lastBounceSide?: PingPongSide;
  winner?: PingPongSide;
  status: 'idle' | 'waiting' | 'serve' | 'rally' | 'point' | 'ended';
  /** The stroke the server is holding the ball up for, and the side it must be struck from. */
  serving?: { side: PingPongSide; kind: PingPongShotKind };
  ball?: PingPongBallState;
}

/** How a match is played: games to win, points in a game, and how long between points (s). */
export const PINGPONG_MATCH = { games: 3, points: 11, winBy: 2, breakSeconds: 1.6 } as const;

export function defaultPingPongState(): PingPongState {
  return {
    active: false,
    mode: 'bot',
    score: { west: 0, east: 0 },
    games: { west: 0, east: 0 },
    server: 'west',
    rally: 0,
    status: 'idle',
  };
}

/**
 * The match after a point to `winner`: the score on, whether it won the game, whose serve is next
 * (two each, alternating) and whether the match is over. One place, so the floor and every client
 * read the same match off the same rule.
 */
export function afterPoint(state: PingPongState, winner: PingPongSide): { score: { west: number; east: number }; games: { west: number; east: number }; server: PingPongSide; gameWon: boolean; matchWon: boolean } {
  const score = { ...state.score, [winner]: state.score[winner] + 1 };
  const games = { ...state.games };
  // Two serves each, alternating: the point about to be played decides whose it is.
  const total = score.west + score.east;
  const switchServe = total >= 20 || total % 2 === 0;
  const server: PingPongSide = switchServe ? otherSide(state.server) : state.server;
  const gameWon = score[winner] >= PINGPONG_MATCH.points && score[otherSide(winner)] <= score[winner] - PINGPONG_MATCH.winBy;
  if (gameWon) {
    games[winner]++;
    return { score: { west: 0, east: 0 }, games, server: winner, gameWon, matchWon: games[winner] >= PINGPONG_MATCH.games };
  }
  return { score, games, server, gameWon, matchWon: false };
}

/** The score as it goes on the board by the table: games first, then the points in this game. */
export function scoreLine(state: PingPongState): string {
  const p = state.score;
  const g = state.games;
  return `${g.west} - ${g.east}  ·  ${p.west} - ${p.east}`;
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
