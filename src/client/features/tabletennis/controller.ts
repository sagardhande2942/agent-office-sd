/**
 * Table tennis player and bot gameplay controller: paddle swinging, physics,
 * ball bounces, scoring, and bot AI returns.
 */
import * as THREE from 'three';
import {
  type BotDifficulty,
  type PingPongMode,
  type PingPongSide,
  type PingPongState,
  inTableHalf,
  PINGPONG_PHYSICS,
  PINGPONG_SPOTS,
  PINGPONG_TABLE,
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

export class TableTennisController {
  active = false;
  side: PingPongSide = 'west';
  mode: PingPongMode = 'bot';
  difficulty: BotDifficulty = 'normal';

  // Ball physical state
  ballPos = new THREE.Vector3(PINGPONG_TABLE.x, PINGPONG_TABLE.height + 0.1, PINGPONG_TABLE.z);
  ballVel = new THREE.Vector3(0, 0, 0);
  ballInPlay = false;
  bouncesOnCurrentSide = 0;
  lastBounceSide: PingPongSide | null = null;
  lastHitter: PingPongSide | null = null;

  // Local player paddle state
  paddleOffsetZ = 0;
  paddleOffsetX = 0;
  swinging = false;
  swingProgress = 0;

  // Worker Bot paddle state
  botPaddleZ = PINGPONG_TABLE.z;
  botPaddleY = PINGPONG_TABLE.height + 0.15;
  botSwinging = false;
  botSwingProgress = 0;

  private savedView: 'first' | 'third' = 'first';

  constructor(
    private readonly player: PlayerController,
    private readonly court: () => TableTennisCourt3D | undefined,
    private readonly cb: TableTennisCallbacks,
    private readonly me?: () => { root: { visible: boolean } } | undefined,
  ) {}

  start(side: PingPongSide, mode: PingPongMode, difficulty: BotDifficulty = 'normal') {
    this.active = true;
    this.side = side;
    this.mode = mode;
    this.difficulty = difficulty;
    this.paddleOffsetZ = 0;
    this.paddleOffsetX = 0;
    this.ballInPlay = false;

    // Teleport player to their playing spot, facing the table
    // (West player at X=4 faces East (+X, -Math.PI/2), East player at X=8 faces West (-X, Math.PI/2))
    const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
    this.player.pos.set(spot.x, 0, spot.z);
    this.player.facing = spot.rotY;
    this.player.camYaw = this.player.facing;
    this.player.lookPitch = -0.12;

    this.savedView = this.player.view;
    this.player.view = 'first';
    const m = this.me?.();
    if (m) m.root.visible = false;
  }

  stop() {
    this.active = false;
    this.ballInPlay = false;
    this.player.view = this.savedView;
    this.cb.onDone();
  }

  swing() {
    if (!this.active || this.swinging) return;
    this.swinging = true;
    this.swingProgress = 0;

    const c = this.court();
    if (!c) return;

    // If ball not in play, this swing is a serve!
    if (!this.ballInPlay) {
      this.serve();
      return;
    }

    // Check if ball is in hit range of player paddle
    const paddleX = this.side === 'west' ? PINGPONG_TABLE.x - 1.4 + this.paddleOffsetX : PINGPONG_TABLE.x + 1.4 + this.paddleOffsetX;
    const paddleZ = PINGPONG_TABLE.z + this.paddleOffsetZ;
    const paddleY = PINGPONG_TABLE.height + 0.15;

    const dist = Math.hypot(this.ballPos.x - paddleX, this.ballPos.z - paddleZ);
    const heightDiff = Math.abs(this.ballPos.y - paddleY);

    if (dist < 0.65 && heightDiff < 0.45) {
      // Valid hit!
      const dirX = this.side === 'west' ? 1 : -1;
      const speedX = (4.8 + Math.random() * 0.8) * dirX;
      const liftY = 2.8 + Math.random() * 0.4;
      const angleZ = (paddleZ - this.ballPos.z) * -3.2;

      this.ballVel.set(speedX, liftY, angleZ);
      this.lastHitter = this.side;
      this.bouncesOnCurrentSide = 0;
      this.lastBounceSide = null;

      this.cb.playSound('paddle');
      this.cb.sendHit(this.side, this.ballPos.x, this.ballPos.y, this.ballPos.z, speedX, liftY, angleZ);
    }
  }

  private serve() {
    this.ballInPlay = true;
    const dirX = this.side === 'west' ? 1 : -1;
    const startX = this.side === 'west' ? PINGPONG_TABLE.x - 1.3 : PINGPONG_TABLE.x + 1.3;
    this.ballPos.set(startX, PINGPONG_TABLE.height + 0.25, PINGPONG_TABLE.z + this.paddleOffsetZ);

    const speedX = (4.4 + Math.random() * 0.5) * dirX;
    const liftY = 3.0;
    const angleZ = (Math.random() - 0.5) * 0.8;

    this.ballVel.set(speedX, liftY, angleZ);
    this.lastHitter = this.side;
    this.bouncesOnCurrentSide = 0;
    this.lastBounceSide = null;

    this.cb.playSound('paddle');
    this.cb.sendServe(this.side, speedX, liftY, angleZ);
  }

  shiftPaddle(dz: number, dx = 0) {
    this.paddleOffsetZ = Math.max(-0.65, Math.min(0.65, this.paddleOffsetZ + dz));
    this.paddleOffsetX = Math.max(-0.35, Math.min(0.35, this.paddleOffsetX + dx));
  }

  update(dt: number, state: PingPongState) {
    const c = this.court();
    if (!c) return;

    if (this.active && this.player.view === 'first') {
      const m = this.me?.();
      if (m) m.root.visible = false;
    }

    // Swing animation
    if (this.swinging) {
      this.swingProgress += dt * 6.5;
      if (this.swingProgress >= Math.PI) {
        this.swinging = false;
        this.swingProgress = 0;
      }
    }

    if (this.botSwinging) {
      this.botSwingProgress += dt * 6.5;
      if (this.botSwingProgress >= Math.PI) {
        this.botSwinging = false;
        this.botSwingProgress = 0;
      }
    }

    // Update player paddle position in 3D
    const localPaddleX = this.side === 'west' ? PINGPONG_TABLE.x - 1.4 + this.paddleOffsetX : PINGPONG_TABLE.x + 1.4 + this.paddleOffsetX;
    const localPaddleZ = PINGPONG_TABLE.z + this.paddleOffsetZ;
    const swingTilt = Math.sin(this.swingProgress) * 0.6;
    c.setPaddle(this.side, localPaddleX, PINGPONG_TABLE.height + 0.15, localPaddleZ, swingTilt * (this.side === 'west' ? 1 : -1));

    // Update bot paddle if in bot mode
    if (this.mode === 'bot') {
      this.updateBot(dt);
      const botTilt = Math.sin(this.botSwingProgress) * -0.6;
      c.setPaddle('east', PINGPONG_TABLE.x + 1.4, this.botPaddleY, this.botPaddleZ, botTilt);
    }

    // Update ball physics if active
    if (this.ballInPlay) {
      this.updateBallPhysics(dt);
    } else {
      // Idle ball sitting on table or in front of server
      if (this.active) {
        const servX = this.side === 'west' ? PINGPONG_TABLE.x - 1.3 : PINGPONG_TABLE.x + 1.3;
        c.setBall(servX, PINGPONG_TABLE.height + 0.15, PINGPONG_TABLE.z + this.paddleOffsetZ, true);
      } else if (state.ball) {
        c.setBall(state.ball.x, state.ball.y, state.ball.z, true);
      }
    }
  }

  private updateBot(dt: number) {
    // Track ball Z position with reaction delay
    const targetZ = this.ballInPlay && this.ballVel.x > 0 ? this.ballPos.z : PINGPONG_TABLE.z;
    const botSpeed = this.difficulty === 'easy' ? 2.5 : this.difficulty === 'normal' ? 3.8 : 5.2;
    this.botPaddleZ += (targetZ - this.botPaddleZ) * Math.min(1, dt * botSpeed);

    // Bot swing trigger when ball crosses to East side
    if (this.ballInPlay && this.ballVel.x > 0 && this.ballPos.x > PINGPONG_TABLE.x + 0.9 && !this.botSwinging) {
      const dist = Math.hypot(this.ballPos.x - (PINGPONG_TABLE.x + 1.35), this.ballPos.z - this.botPaddleZ);
      if (dist < 0.7) {
        this.botSwinging = true;
        this.botSwingProgress = 0;

        // Bot returns ball to West half
        const speedX = -(4.6 + Math.random() * 0.7);
        const liftY = 2.9 + Math.random() * 0.4;
        const targetSideZ = (Math.random() - 0.5) * (this.difficulty === 'easy' ? 0.9 : 0.6);

        this.ballVel.set(speedX, liftY, targetSideZ * 2.2);
        this.lastHitter = 'east';
        this.bouncesOnCurrentSide = 0;
        this.lastBounceSide = null;

        this.cb.playSound('paddle');
        this.cb.sendHit('east', this.ballPos.x, this.ballPos.y, this.ballPos.z, speedX, liftY, targetSideZ * 2.2);
      }
    }
  }

  private updateBallPhysics(dt: number) {
    const c = this.court();
    if (!c) return;

    // Gravity
    this.ballVel.y -= PINGPONG_PHYSICS.gravity * dt;

    // Position step
    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.y += this.ballVel.y * dt;
    this.ballPos.z += this.ballVel.z * dt;

    c.setBall(this.ballPos.x, this.ballPos.y, this.ballPos.z, true);

    // Net collision: net is at x = 6.0, height from 0.76 to 0.9125, z in [14.15, 15.85]
    if (
      Math.abs(this.ballPos.x - PINGPONG_TABLE.x) < 0.04 &&
      this.ballPos.y >= PINGPONG_TABLE.height &&
      this.ballPos.y <= PINGPONG_TABLE.height + PINGPONG_TABLE.netHeight &&
      this.ballPos.z >= PINGPONG_TABLE.z - PINGPONG_TABLE.width / 2 - 0.08 &&
      this.ballPos.z <= PINGPONG_TABLE.z + PINGPONG_TABLE.width / 2 + 0.08
    ) {
      // Net hit!
      this.ballVel.x *= -0.35;
      this.cb.playSound('net');
      return;
    }

    // Table surface bounce
    const tableTop = PINGPONG_TABLE.height;
    if (this.ballPos.y <= tableTop && this.ballVel.y < 0) {
      const onWest = inTableHalf('west', this.ballPos.x, this.ballPos.z);
      const onEast = inTableHalf('east', this.ballPos.x, this.ballPos.z);

      if (onWest || onEast) {
        this.ballPos.y = tableTop;
        this.ballVel.y = -this.ballVel.y * PINGPONG_PHYSICS.restitution;
        this.cb.playSound('table');

        const bounceSide: PingPongSide = onWest ? 'west' : 'east';
        if (this.lastBounceSide === bounceSide) {
          // Double bounce on same side! Point to opposite side!
          this.ballInPlay = false;
          const winner: PingPongSide = bounceSide === 'west' ? 'east' : 'west';
          this.cb.awardPoint(winner, 'Double bounce');
          return;
        }

        this.lastBounceSide = bounceSide;
        return;
      }
    }

    // Hit floor (deck at y = 0)
    if (this.ballPos.y <= 0) {
      this.ballInPlay = false;
      // If ball bounced on opponent side first, hitter scores; otherwise opponent scores
      if (this.lastBounceSide && this.lastHitter && this.lastBounceSide !== this.lastHitter) {
        this.cb.awardPoint(this.lastHitter, 'Ball landed out of reach');
      } else {
        const winner: PingPongSide = this.lastHitter === 'west' ? 'east' : 'west';
        this.cb.awardPoint(winner, 'Ball out of bounds');
      }
    }
  }
}
