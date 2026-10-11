import type { BotDifficulty, PingPongMode, PingPongSide, PingPongState } from '../tabletennis.js';

export type TableTennisClientMsg =
  /** Join a table tennis match on the balcony as west or east player, against a worker bot or another player. */
  | { t: 'pingpong.join'; side: PingPongSide; mode: PingPongMode; botName?: string; difficulty?: BotDifficulty }
  /** Step back from the table / leave current match. */
  | { t: 'pingpong.leave' }
  /** Serve the ball from your side. */
  | { t: 'pingpong.serve'; side: PingPongSide; vx: number; vy: number; vz: number }
  /** Return/hit the ball with your paddle across the net. */
  | { t: 'pingpong.hit'; side: PingPongSide; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Award a point (due to out-of-bounds, net fault, double bounce, etc.). */
  | { t: 'pingpong.point'; winner: PingPongSide; reason?: string }
  /** Reset match scores and rally. */
  | { t: 'pingpong.reset' };

export type TableTennisServerMsg =
  /** Full table tennis state broadcast to everyone on the floor. */
  | { t: 'pingpong.state'; state: PingPongState }
  /** Real-time paddle hit event. */
  | { t: 'pingpong.hit'; side: PingPongSide; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Point scored or match won. */
  | { t: 'pingpong.point'; winner: PingPongSide; score: { west: number; east: number }; text: string; sound?: 'point' | 'win' };
