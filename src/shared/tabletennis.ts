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

export const PINGPONG_SPOTS = {
  west: { x: PINGPONG_TABLE.x - 2.0, y: 0, z: PINGPONG_TABLE.z, rotY: -Math.PI / 2 },
  east: { x: PINGPONG_TABLE.x + 2.0, y: 0, z: PINGPONG_TABLE.z, rotY: Math.PI / 2 },
} as const;

export const PINGPONG_PHYSICS = {
  ballRadius: 0.035,
  gravity: 9.8,
  restitution: 0.86,
  pointsToWin: 11,
} as const;

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
