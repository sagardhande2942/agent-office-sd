/**
 * The worker bot at the other end of the table: where it stands, what it plays, and how well.
 *
 * It used to track the ball's sideways position and hit whatever crossed a line, which meant it
 * never moved its feet, never aimed anywhere, and could not play a short ball. It now reads the
 * ball's flight, walks to where it is going rather than where it is, goes for the space the player
 * has left open, and picks a stroke to suit the ball it is given — and it misses, as much as its
 * skill says it should.
 */
import {
  type BotDifficulty,
  type PingPongFlight,
  type PingPongShotKind,
  type PingPongSide,
  PINGPONG_TABLE,
  PINGPONG_COURT,
  PINGPONG_PHYSICS,
  PINGPONG_SPOTS,
  PINGPONG_STROKES,
  meetPoint,
  onCourtSpot,
  shotTarget,
  solveShot,
} from '../../../shared/tabletennis';

/** How good it is: how fast it moves, how quickly it reads the ball, how accurately it aims, how often it misses. */
export interface BotSkill {
  /** Seconds before it reacts to a ball struck at it. */
  reaction: number;
  /** How fast it shuffles along its end (m/s). */
  pace: number;
  /** How far off its aim it plays (m), and how far off the ball it meets it (m). */
  aimError: number;
  reachError: number;
  /** The chance it simply misses a ball it had every chance on (0..1). */
  shank: number;
  /** How often it plays something other than the sensible stroke (0..1). */
  flourish: number;
}

const SKILL: Record<BotDifficulty, BotSkill> = {
  easy: { reaction: 0.34, pace: 1.5, aimError: 0.42, reachError: 0.34, shank: 0.45, flourish: 0.1 },
  normal: { reaction: 0.19, pace: 2.5, aimError: 0.22, reachError: 0.16, shank: 0.18, flourish: 0.22 },
  pro: { reaction: 0.08, pace: 3.6, aimError: 0.08, reachError: 0.05, shank: 0.04, flourish: 0.4 },
};

/** What it has decided to do about the ball in the air. */
export interface BotPlan {
  /** Where it is walking to. */
  to: { x: number; z: number };
  /** The stroke it will play, once it is in range, or undefined while it is still getting there. */
  stroke?: PingPongShotKind;
  /** The spot it aims at. */
  aim: { x: number; z: number };
  /** How far from its ideal spot it is, so the caller can know whether it will get there. */
  out: number;
}

export class TableTennisBot {
  private pos: { x: number; z: number } = { x: PINGPONG_SPOTS.east.x, z: PINGPONG_SPOTS.east.z };
  private seen = -1;
  private waited = 0;
  private planFor: PingPongShotKind | undefined;
  private aimFor: { x: number; z: number } = { x: 0, z: PINGPONG_TABLE.z };

  constructor(private difficulty: BotDifficulty = 'normal') {}

  get skill(): BotSkill {
    return SKILL[this.difficulty];
  }

  /** Where its body is. */
  get where(): { x: number; z: number } {
    return this.pos;
  }

  /** Puts it back at its spot for a new match. */
  reset(side: PingPongSide) {
    this.pos = { x: side === 'west' ? PINGPONG_SPOTS.west.x : PINGPONG_SPOTS.east.x, z: PINGPONG_SPOTS.east.z };
    this.planFor = undefined;
    this.waited = 0;
  }

  /**
   * Works out where to stand for the ball in the air and what to play at it. `player` is where the
   * other player is standing, so it can go for the space they have left.
   */
  plan(ball: PingPongFlight | null, side: PingPongSide, player: { x: number; z: number }): BotPlan {
    const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
    if (!ball) {
      // Between points: back to the middle, watching.
      const to = onCourtSpot(side, this.pos.x, spot.z * 0.6 + this.pos.z * 0.4);
      return { to, aim: { x: 0, z: PINGPONG_TABLE.z }, out: 0 };
    }
    // Where the ball will cross the plane in front of its bat.
    const meet = meetPoint(ball, side);
    // Where it will be waiting for the ball, minus a little so its own reach error bites.
    const z = meet ? meet.z : PINGPONG_TABLE.z;
    const off = this.skill.reachError * (Math.sign(z - PINGPONG_TABLE.z) || 1) * (side === 'west' ? -1 : 1);
    const to = onCourtSpot(side, spot.x, z + off);
    const out = Math.hypot(this.pos.x - to.x, this.pos.z - to.z);
    const stroke = meet && this.waited >= this.skill.reaction ? this.choose(meet) : undefined;
    this.aimFor = shotTarget(side, this.aimAcross(player), stroke === 'smash' ? -0.6 : 0, (Math.random() - 0.5) * this.skill.aimError);
    return { to, stroke, aim: this.aimFor, out };
  }

  /**
   * Marks how long it has been watching the ball struck as `stamp` (the rally's shot count, so a new
   * shot resets its clock). It only starts moving once its reaction has passed.
   */
  look(stamp: number | null, dt: number) {
    this.waited = stamp !== null && this.seen === stamp ? this.waited + dt : 0;
    this.seen = stamp ?? -1;
  }

  /** Moves it towards where it meant to be, as fast as its legs go. */
  step(dt: number, to: { x: number; z: number }) {
    const pace = this.skill.pace * dt;
    const dx = to.x - this.pos.x;
    const dz = to.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const step = Math.min(pace, d);
    this.pos = { x: this.pos.x + (dx / d) * step, z: this.pos.z + (dz / d) * step };
  }

  /**
   * Whether it can actually get its bat to the ball from where it is standing: it has to have read
   * the ball (not still waiting out its reaction), be within its own reach, and not be one of the
   * misses its skill allows.
   */
  canMeet(ball: PingPongFlight, plan: BotPlan, random = Math.random()): boolean {
    if (!plan.stroke) return false;
    if (plan.out > PINGPONG_COURT.lunge) return false;
    if (Math.hypot(ball.x - this.pos.x, ball.z - this.pos.z) > PINGPONG_COURT.lunge) return false;
    return random >= this.skill.shank;
  }

  /** How it plays the ball it is given: a short high ball is a smash, a deep low one is cut back. */
  private choose(meet: { y: number; t: number }): PingPongShotKind {
    const high = meet.y > PINGPONG_TABLE.height + 0.25;
    const short = meet.t < 0.55;
    if (Math.random() < this.skill.flourish) return Math.random() < 0.5 ? 'smash' : 'backspin';
    return short && high ? 'smash' : high ? 'topspin' : 'backspin';
  }

  /** Goes for the table the player has walked away from. */
  private aimAcross(player: { x: number; z: number }): number {
    const away = Math.sign(PINGPONG_TABLE.z - player.z) || 1;
    return away * 0.55;
  }

  /** The shot it plays from where it stands, aimed where it decided. */
  shot(side: PingPongSide, aim: { x: number; z: number }, stroke: PingPongShotKind) {
    const from = { x: side === 'west' ? PINGPONG_TABLE.x - PINGPONG_PHYSICS.paddleReach : PINGPONG_TABLE.x + PINGPONG_PHYSICS.paddleReach, y: PINGPONG_TABLE.height + PINGPONG_PHYSICS.paddleHeight, z: this.pos.z };
    return solveShot(from, aim, stroke);
  }
}

/** The speed a stroke leaves the bat at, for anyone reading the numbers. */
export const strokeSpeed = (kind: PingPongShotKind) => PINGPONG_STROKES[kind].speed;