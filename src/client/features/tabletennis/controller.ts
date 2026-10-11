/**
 * Table tennis player and bot gameplay controller: paddle swinging, shot solving,
 * ball flight, bounces, scoring, and the bot's returns.
 */
import * as THREE from 'three';
import {
  type BotDifficulty,
  type PingPongBallState,
  type PingPongMode,
  type PingPongSide,
  type PingPongState,
  inTableHalf,
  otherSide,
  PINGPONG_PHYSICS,
  PINGPONG_SPOTS,
  PINGPONG_TABLE,
  shotTarget,
  solveShot,
} from '../../../shared/tabletennis';
import type { PlayerController } from '../../player';
import type { TableTennisCourt3D } from './world';

export interface TableTennisCallbacks {
  sendServe(side: PingPongSide, vx: number, vy: number, vz: number): void;
  sendHit(side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number): void;
  awardPoint(winner: PingPongSide, reason?: string): void;
  playSound(kind: 'paddle' | 'table' | 'net' | 'point' | 'win'): void;
  onDone(): void;
}

/** How near the ball has to be to the paddle for a swing to meet it (m). */
const REACH = 0.72;
/** How long the net holds the ball back before it will bounce it again (s), so it can't rattle. */
const NET_HOLD = 0.25;
/** A paddle's reach across the table and its depth, the halves an aim is measured in (m). */
const AIM_SPAN = PINGPONG_TABLE.width / 2;
const DEPTH_SPAN = PINGPONG_TABLE.length / 4;

export class TableTennisController {
  active = false;
  side: PingPongSide = 'west';
  mode: PingPongMode = 'bot';
  difficulty: BotDifficulty = 'normal';
  /** The half the opponent plays: the far side in bot mode, the other player's side in PvP. */
  opponent: PingPongSide = 'east';

  // Ball physical state
  ballPos = new THREE.Vector3(PINGPONG_TABLE.x, PINGPONG_TABLE.height + 0.1, PINGPONG_TABLE.z);
  ballVel = new THREE.Vector3(0, 0, 0);
  ballInPlay = false;
  bouncesOnCurrentSide = 0;
  lastBounceSide: PingPongSide | null = null;
  lastHitter: PingPongSide | null = null;
  /** The server's clock for the shot in flight, so a ball struck by the other player is taken once. */
  private seenAt = 0;
  private netHold = 0;
  /** Where the ball was last frame: a slow frame steps it far, so a bat is met against the whole way. */
  private readonly ballPrev = new THREE.Vector3();

  // Local player paddle state
  paddleOffsetZ = 0;
  paddleOffsetX = 0;
  swinging = false;
  swingProgress = 0;

  // Opponent paddle state (the bot's, or where the far player's bat is)
  oppPaddleZ = PINGPONG_TABLE.z;
  oppSwinging = false;
  oppSwingProgress = 0;

  constructor(
    private readonly player: PlayerController,
    private readonly court: () => TableTennisCourt3D | undefined,
    private readonly cb: TableTennisCallbacks,
  ) {}

  start(side: PingPongSide, mode: PingPongMode, difficulty: BotDifficulty = 'normal') {
    this.active = true;
    this.side = side;
    this.mode = mode;
    this.difficulty = difficulty;
    this.opponent = otherSide(side);
    this.paddleOffsetZ = 0;
    this.paddleOffsetX = 0;
    this.ballInPlay = false;
    this.oppPaddleZ = PINGPONG_TABLE.z;

    // Stand at your end of the table, facing it. camYaw is a camera heading, which is the body's
    // turned half a circle round from it (see player/index.ts), so it takes the other way.
    const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
    this.player.pos.set(spot.x, 0, spot.z);
    this.player.facing = spot.rotY;
    this.player.camYaw = spot.rotY - Math.PI;
    this.player.lookPitch = -0.12;
  }

  stop() {
    this.active = false;
    this.ballInPlay = false;
    this.cb.onDone();
  }

  /** Where your paddle is in the world, given your side and how far across and in you have moved it. */
  get paddleX(): number {
    const reach = PINGPONG_PHYSICS.paddleReach;
    return (this.side === 'west' ? PINGPONG_TABLE.x - reach : PINGPONG_TABLE.x + reach) + this.paddleOffsetX;
  }

  get paddleY(): number {
    return PINGPONG_TABLE.height + PINGPONG_PHYSICS.paddleHeight;
  }

  get paddleZ(): number {
    return PINGPONG_TABLE.z + this.paddleOffsetZ;
  }

  /** Where the far side's paddle is: just past the end of the table, tracking across it. */
  get oppPaddleX(): number {
    return this.opponent === 'west' ? PINGPONG_TABLE.x - PINGPONG_PHYSICS.paddleReach : PINGPONG_TABLE.x + PINGPONG_PHYSICS.paddleReach;
  }

  /**
   * Takes the ball as the floor has it, when the other player struck it: both players fly the same
   * ball from the same state, so a rally looks the same from either end of the table.
   */
  adopt(ball: PingPongBallState | undefined) {
    if (!ball || ball.t < this.seenAt) return;
    this.seenAt = ball.t;
    this.ballPos.set(ball.x, ball.y, ball.z);
    this.ballVel.set(ball.vx, ball.vy, ball.vz);
    this.ballInPlay = true;
    this.lastBounceSide = null;
    this.netHold = 0;
    this.bouncesOnCurrentSide = 0;
    this.lastHitter = ball.vx >= 0 ? 'west' : 'east';
  }

  swing() {
    if (!this.active || this.swinging) return;
    this.swinging = true;
    this.swingProgress = 0;

    if (!this.court()) return;
    // Nothing in flight: this swing is the serve.
    if (!this.ballInPlay) {
      this.serve();
      return;
    }

    if (this.batCanReach(this.paddleX, this.paddleY, this.paddleZ)) this.hit(this.side);
  }

  /** Strikes the ball in play, aimed into the far half by where your paddle is. */
  private hit(side: PingPongSide, aim = 0, depth = 0) {
    const reach = PINGPONG_PHYSICS.paddleReach;
    const from = side === 'west'
      ? { x: PINGPONG_TABLE.x - reach, y: this.paddleY, z: PINGPONG_TABLE.z + (side === this.side ? this.paddleOffsetZ : 0) }
      : { x: PINGPONG_TABLE.x + reach, y: this.paddleY, z: PINGPONG_TABLE.z + (side === this.side ? this.paddleOffsetZ : 0) };
    const spot = shotTarget(side, aim / AIM_SPAN, depth / DEPTH_SPAN, (Math.random() - 0.5) * 0.12);
    const shot = solveShot(from, spot, PINGPONG_PHYSICS.shotSpeed + Math.random() * 0.3);

    this.ballVel.set(shot.vx, shot.vy, shot.vz);
    this.ballPos.set(from.x, from.y, from.z);
    this.lastHitter = side;
    this.bouncesOnCurrentSide = 0;
    this.lastBounceSide = null;
    this.netHold = 0;

    this.cb.playSound('paddle');
    this.cb.sendHit(side, from.x, from.y, from.z, shot.vx, shot.vy, shot.vz);
  }

  private serve() {
    const reach = 1.2;
    const from = this.side === 'west'
      ? { x: PINGPONG_TABLE.x - reach, y: PINGPONG_TABLE.height + 0.22, z: PINGPONG_TABLE.z + this.paddleOffsetZ * 0.5 }
      : { x: PINGPONG_TABLE.x + reach, y: PINGPONG_TABLE.height + 0.22, z: PINGPONG_TABLE.z + this.paddleOffsetZ * 0.5 };
    const spot = shotTarget(this.side, (this.paddleOffsetZ * 0.5) / AIM_SPAN, -0.25, (Math.random() - 0.5) * 0.1);
    const shot = solveShot(from, spot, PINGPONG_PHYSICS.shotSpeed * 0.85 + Math.random() * 0.2);

    this.ballInPlay = true;
    this.ballPos.set(from.x, from.y, from.z);
    this.ballVel.set(shot.vx, shot.vy, shot.vz);
    this.lastHitter = this.side;
    this.bouncesOnCurrentSide = 0;
    this.lastBounceSide = null;
    this.netHold = 0;

    this.cb.playSound('paddle');
    this.cb.sendServe(this.side, shot.vx, shot.vy, shot.vz);
  }

  shiftPaddle(dz: number, dx = 0) {
    this.paddleOffsetZ = Math.max(-0.6, Math.min(0.6, this.paddleOffsetZ + dz));
    this.paddleOffsetX = Math.max(-0.3, Math.min(0.3, this.paddleOffsetX + dx));
  }

  update(dt: number, state: PingPongState) {
    const c = this.court();
    if (!c) return;

    if (this.swinging) {
      this.swingProgress += dt * 6.5;
      if (this.swingProgress >= Math.PI) {
        this.swinging = false;
        this.swingProgress = 0;
      }
    }
    if (this.oppSwinging) {
      this.oppSwingProgress += dt * 6.5;
      if (this.oppSwingProgress >= Math.PI) {
        this.oppSwinging = false;
        this.oppSwingProgress = 0;
      }
    }

    this.ballPrev.copy(this.ballPos);
    // The ball. Where the bats are is the avatar's business (they hang in their holders' hands).
    if (this.mode === 'bot') this.updateBot(dt);
    if (this.ballInPlay) {
      this.updateBallPhysics(dt);
    } else if (this.active) {
      // Waiting on the serve: the ball rests on the server's paddle.
      c.setBall(this.paddleX, this.paddleY, this.paddleZ, true);
    } else if (state.ball) {
      c.setBall(state.ball.x, state.ball.y, state.ball.z, true);
    }
  }

  private updateBot(dt: number) {
    // Track across the table after the ball, with a beat of reaction, and only when it's coming.
    const toward = this.opponent === 'east' ? 1 : -1;
    const incoming = this.ballInPlay && Math.sign(this.ballVel.x) === toward;
    const targetZ = incoming ? this.ballPos.z : PINGPONG_TABLE.z;
    const botSpeed = this.difficulty === 'easy' ? 2.5 : this.difficulty === 'normal' ? 3.8 : 5.2;
    this.oppPaddleZ += (targetZ - this.oppPaddleZ) * Math.min(1, dt * botSpeed);

    if (!incoming || this.oppSwinging) return;
    if (!this.batCanReach(this.oppPaddleX, this.paddleY, this.oppPaddleZ, 0.9)) return;
    const near = Math.hypot(this.ballPos.x - this.oppPaddleX, this.ballPos.z - this.oppPaddleZ);
    this.oppSwinging = true;
    this.oppSwingProgress = 0;
    // How well it reaches the ball decides how deep it puts it back.
    const reach = (0.8 - near) / 0.8;
    const aim = (this.oppPaddleZ - this.ballPos.z) * 1.2;
    this.hit(this.opponent, aim, -0.2 - reach * (this.difficulty === 'easy' ? 0 : 0.5));
  }

  /**
   * Whether a bat held at (x, y, z) meets the ball: the closest the ball came to it over the whole of
   * this frame, not just where it ended up. On a slow frame the ball steps most of a metre, and a
   * bat that only looked at the end of it would swing through where the ball had been.
   */
  private batCanReach(x: number, y: number, z: number, reach = REACH): boolean {
    const dx = this.ballPos.x - this.ballPrev.x;
    const dy = this.ballPos.y - this.ballPrev.y;
    const dz = this.ballPos.z - this.ballPrev.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - this.ballPrev.x) * dx + (y - this.ballPrev.y) * dy + (z - this.ballPrev.z) * dz) / len2));
    const px = this.ballPrev.x + dx * t;
    const py = this.ballPrev.y + dy * t;
    const pz = this.ballPrev.z + dz * t;
    if (Math.abs(py - y) > 0.45) return false;
    return Math.hypot(px - x, pz - z) < reach;
  }

  private updateBallPhysics(dt: number) {
    const c = this.court();
    if (!c) return;

    // Step small enough that the ball cannot skip the net or the far edge on a slow frame.
    const steps = Math.min(64, Math.max(1, Math.ceil(dt / 0.008)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (!this.ballInPlay) return;

      this.ballVel.y -= PINGPONG_PHYSICS.gravity * h;
      this.ballPos.x += this.ballVel.x * h;
      this.ballPos.y += this.ballVel.y * h;
      this.ballPos.z += this.ballVel.z * h;
      this.netHold = Math.max(0, this.netHold - h);

      // The net, once: it stops the ball dead rather than flipping it back and forth every frame.
      if (
        this.netHold <= 0 &&
        Math.abs(this.ballPos.x - PINGPONG_TABLE.x) < PINGPONG_TABLE.thickness / 2 + this.ballVel.x * h &&
        this.ballPos.y >= PINGPONG_TABLE.height &&
        this.ballPos.y <= PINGPONG_TABLE.height + PINGPONG_TABLE.netHeight &&
        Math.abs(this.ballPos.z - PINGPONG_TABLE.z) <= PINGPONG_TABLE.width / 2 + 0.08
      ) {
        this.ballPos.x = PINGPONG_TABLE.x + Math.sign(this.ballVel.x || 1) * (PINGPONG_TABLE.thickness / 2 + 0.01);
        this.ballVel.x *= -0.2;
        this.ballVel.y *= 0.4;
        this.netHold = NET_HOLD;
        this.cb.playSound('net');
        continue;
      }

      if (this.ballPos.y <= PINGPONG_TABLE.height && this.ballVel.y < 0) {
        const side = inTableHalf('west', this.ballPos.x, this.ballPos.z) ? 'west' : inTableHalf('east', this.ballPos.x, this.ballPos.z) ? 'east' : null;
        if (side) {
          this.ballPos.y = PINGPONG_TABLE.height;
          this.ballVel.y = -this.ballVel.y * PINGPONG_PHYSICS.restitution;
          this.cb.playSound('table');
          if (this.lastBounceSide === side) {
            // Bounced twice on the far side without being returned: the striker loses the point.
            this.ballInPlay = false;
            this.cb.awardPoint(otherSide(side), 'Double bounce');
            return;
          }
          this.lastBounceSide = side;
          continue;
        }
      }

      if (this.ballPos.y <= 0) {
        this.ballInPlay = false;
        const winner = this.lastBounceSide && this.lastHitter && this.lastBounceSide !== this.lastHitter
          ? this.lastHitter
          : this.lastHitter
            ? otherSide(this.lastHitter)
            : otherSide(this.side);
        this.cb.awardPoint(winner, 'Out');
      }
    }

    c.setBall(this.ballPos.x, this.ballPos.y, this.ballPos.z, true);
  }
}