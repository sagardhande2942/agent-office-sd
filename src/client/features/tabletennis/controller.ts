/**
 * Table tennis gameplay: your feet, your bat, the ball, and the worker bot at the other end.
 *
 * Shots are solved for the spot they are aimed at (see shared/tabletennis solveShot) and carry the
 * spin of the stroke that played them, which the flight and the bounce both answer to. You walk
 * round your own end of the table to reach a ball rather than covering it from one spot, and the
 * bot reads the ball's flight, walks to where it is going, and plays the space you have left open.
 */
import { netContact } from '../../../shared/tabletennis-ballistics';
import * as THREE from 'three';
import {
  type BotDifficulty,
  type PingPongBallState,
  type PingPongMode,
  type PingPongShotKind,
  type PingPongSide,
  type PingPongState,
  flyStep,
  defaultPingPongState,
  inTableHalf,
  onCourtSpot,
  otherSide,
  PINGPONG_COURT,
  PINGPONG_MATCH,
  PINGPONG_PHYSICS,
  PINGPONG_SPOTS,
  PINGPONG_TABLE,
  shotTarget,
  solveShot,
  solveServe,
  tableBounce,
} from '../../../shared/tabletennis';
import type { PlayerController } from '../../player';
import { TableTennisBot, type BotPlan } from './bot';
import type { TableTennisCourt3D } from './world';

export interface TableTennisCallbacks {
  sendServe(side: PingPongSide, vx: number, vy: number, vz: number, swing: { tops: number; side: number; kind: PingPongShotKind }, origin?: { x: number; y: number; z: number }): void;
  sendHit(side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number, swing: { tops: number; side: number; kind: PingPongShotKind }): void;
  awardPoint(winner: PingPongSide, reason?: string): void;
  playSound(kind: 'paddle' | 'table' | 'net' | 'point' | 'win'): void;
  onDone(): void;
}

/** The bat hangs this far out in front of your body (m). */
const REACH = 0.46;
/** How high it hangs (m), and how far out to your right-hand side. */
const HAND = 1.04;
const SIDEWAYS = 0.26;
/** How long the net holds the ball before it will bounce it again (s), so it can't rattle. */
const NET_HOLD = 0.25;

export class TableTennisController {
  active = false;
  automatesOpponent = true;
  aim = 0;
  depth = 0;
  side: PingPongSide = 'west';
  mode: PingPongMode = 'bot';
  difficulty: BotDifficulty = 'normal';
  /** The half the opponent plays: the far side in bot mode, the other player's side in PvP. */
  opponent: PingPongSide = 'east';
  /** The stroke you will play if you swing now. */
  stroke: PingPongShotKind = 'topspin';
  /** The last stroke played, for the sound and the bot's reading of it. */
  lastStroke: PingPongShotKind = 'topspin';
  /** The floor's match as it was last seen, so a swing knows whose serve it would be. */
  private state: PingPongState = { active: false, mode: 'bot', score: { west: 0, east: 0 }, games: { west: 0, east: 0 }, server: 'west', rally: 0, status: 'idle' };

  // Ball physical state
  ballPos = new THREE.Vector3(PINGPONG_TABLE.x, PINGPONG_TABLE.height + 0.1, PINGPONG_TABLE.z);
  ballVel = new THREE.Vector3(0, 0, 0);
  /** The spin on the ball in flight. */
  ballTops = 0;
  ballSide = 0;
  ballInPlay = false;
  lastBounceSide: PingPongSide | null = null;
  lastHitter: PingPongSide | null = null;
  /** How long the rally has gone on, and how long since a shot was played (s). */
  rally = 0;
  /** The server's clock for the shot in flight, so a ball struck by the other player is taken once. */
  private seenAt = 0;
  private netHold = 0;
  private serveFlight = false;
  private breakT = 0;
  private readonly ballPrev = new THREE.Vector3();
  private bot = new TableTennisBot();
  private botPlan: BotPlan | undefined;

  // Your feet and bat
  private pos: { x: number; z: number } = { x: PINGPONG_SPOTS.west.x, z: PINGPONG_SPOTS.west.z };
  swinging = false;
  swingProgress = 0;
  /** How long you are still recovering from a swing (s). */
  private recovering = 0;

  // The other player's feet and bat
  oppSwinging = false;
  oppSwingProgress = 0;

  constructor(
    private readonly player: PlayerController,
    private readonly court: () => TableTennisCourt3D | undefined,
    private readonly cb: TableTennisCallbacks,
  ) {}

  start(side: PingPongSide, mode: PingPongMode, difficulty: BotDifficulty = 'normal') {
    this.active = true;
    this.state = defaultPingPongState();
    this.side = side;
    this.mode = mode;
    this.difficulty = difficulty;
    this.opponent = otherSide(side);
    this.ballInPlay = false;
    this.rally = 0;
    // You may serve the moment you are at the table; the break is between points, not before the first.
    this.breakT = PINGPONG_MATCH.breakSeconds;
    this.recovering = 0;
    this.swinging = this.oppSwinging = false;
    this.swingProgress = this.oppSwingProgress = 0;
    this.lastHitter = this.lastBounceSide = null;
    this.bot = new TableTennisBot(difficulty);
    this.bot.reset(this.opponent);
    this.pos = { x: side === 'west' ? PINGPONG_SPOTS.west.x : PINGPONG_SPOTS.east.x, z: PINGPONG_SPOTS.east.z };

    // Stand at your end of the table, facing it. camYaw is a camera heading, which is the body's
    // turned half a circle round from it (see player/index.ts), so it takes the other way.
    const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
    this.player.pos.set(spot.x, 0, spot.z);
    this.player.facing = spot.rotY;
    this.player.camYaw = spot.rotY - Math.PI;
    this.player.lookPitch = -0.32;
  }

  stop() {
    this.active = false;
    this.ballInPlay = false;
    this.cb.onDone();
  }

  /** Where you are standing, on your own end of the table. */
  get where(): { x: number; z: number } {
    return this.pos;
  }

  /** Where the other player is standing: the bot's, or the far player's own body. */
  get oppWhere(): { x: number; z: number } {
    return this.mode !== 'pvp' ? this.bot.where : { x: this.opponent === 'west' ? PINGPONG_SPOTS.west.x : PINGPONG_SPOTS.east.x, z: PINGPONG_TABLE.z };
  }

  /** Where your bat is in the world, in your hand. */
  get bat(): { x: number; y: number; z: number } {
    const dir = this.side === 'west' ? 1 : -1;
    const swing = Math.sin(Math.max(0, this.swingProgress));
    return {
      x: this.pos.x + dir * (REACH + swing * 0.5),
      y: HAND + swing * 0.16,
      z: this.pos.z + (this.side === 'west' ? SIDEWAYS : -SIDEWAYS),
    };
  }

  /** Where the far bat is. */
  get oppBat(): { x: number; y: number; z: number } {
    const dir = this.opponent === 'west' ? 1 : -1;
    const swing = Math.sin(Math.max(0, this.oppSwingProgress));
    return {
      x: this.oppWhere.x + dir * (REACH + swing * 0.5),
      y: HAND + swing * 0.16,
      z: this.oppWhere.z + (this.opponent === 'west' ? SIDEWAYS : -SIDEWAYS),
    };
  }

  /**
   * Walks you round your own end of the table. `mx` and `mz` are -1..1: in, back, and either way
   * across. You are slower for a moment after a swing, which is what a lunge costs you.
   */
  move(dt: number, mx: number, mz: number) {
    if (!this.active) return;
    const pace = PINGPONG_COURT.pace * (this.recovering > 0 ? 0.45 : 1);
    const len = Math.hypot(mx, mz);
    if (len < 0.01) return;
    // In, back, and across, in the table's own frame: +x for a west player.
    const dir = this.side === 'west' ? 1 : -1;
    const step = Math.min(1, len) * pace * dt;
    this.pos = onCourtSpot(this.side, this.pos.x + dir * mz * step, this.pos.z + mx * step);
  }

  /** A bot-controlled seat follows the same court bounds as a human player. */
  automateAt(at: { x: number; z: number }) { this.pos = onCourtSpot(this.side, at.x, at.z); }

  swing(kind: PingPongShotKind = this.stroke, power = 0.5) {
    if (!this.active || this.swinging) return;
    this.swinging = true;
    this.swingProgress = 0;
    this.recovering = PINGPONG_COURT.recovery;
    this.lastStroke = kind;

    if (!this.court()) return;
    // Nothing in flight: that is a serve, but only if it is yours to play and the break is over.
    if (!this.ballInPlay) {
      if (this.serving(this.state)) this.serve(kind, power);
      return;
    }
    const bat = this.bat;
    if (this.lastHitter !== this.side && this.lastBounceSide === this.side && this.batCanReach(bat)) this.hit(this.side, kind, this.aim, this.depth, power);
  }

  /** Strike from the actual contact position instead of teleporting to a fixed lane. */
  private hit(side: PingPongSide, kind: PingPongShotKind, aim = 0, depth = 0, power = 0.5) {
    const from = { x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z };
    const spot = shotTarget(side, aim, depth);
    const shot = solveShot(from, spot, kind, power, aim * 0.45);

    this.ballVel.set(shot.vx, shot.vy, shot.vz);
    this.ballPos.set(from.x, from.y, from.z);
    this.ballTops = shot.tops;
    this.ballSide = shot.side;
    this.ballInPlay = true;
    this.lastHitter = side;
    this.lastBounceSide = null;
    this.netHold = 0;
    this.rally++;
    this.breakT = 0;

    this.cb.playSound('paddle');
    this.serveFlight = false;
    this.cb.sendHit(side, from.x, from.y, from.z, shot.vx, shot.vy, shot.vz, { tops: shot.tops, side: shot.side, kind });
  }

  /** The bot's serve, played from where it is standing. */
  private serveBot(kind: PingPongShotKind) {
    const reach = 1.2;
    const from = this.opponent === 'west'
      ? { x: PINGPONG_TABLE.x - reach, y: PINGPONG_TABLE.height + 0.22, z: Math.max(PINGPONG_TABLE.z - 0.55, Math.min(PINGPONG_TABLE.z + 0.55, this.bot.where.z)) }
      : { x: PINGPONG_TABLE.x + reach, y: PINGPONG_TABLE.height + 0.22, z: Math.max(PINGPONG_TABLE.z - 0.55, Math.min(PINGPONG_TABLE.z + 0.55, this.bot.where.z)) };
    const shot = solveServe(from, shotTarget(this.opponent, (Math.random() - 0.5) * 0.4, -0.2), kind);
    this.ballInPlay = true;
    this.ballPos.set(from.x, from.y, from.z);
    this.ballVel.set(shot.vx, shot.vy, shot.vz);
    this.ballTops = shot.tops;
    this.ballSide = shot.side;
    this.lastHitter = this.opponent;
    this.lastBounceSide = null;
    this.netHold = 0;
    this.rally = 1;
    this.breakT = 0;
    this.cb.playSound('paddle');
    this.serveFlight = true;
    this.cb.sendServe(this.opponent, shot.vx, shot.vy, shot.vz, { tops: shot.tops, side: shot.side, kind }, from);
  }

  private serve(kind: PingPongShotKind, power = 0.5) {
    const reach = 1.2;
    const from = this.side === 'west'
      ? { x: PINGPONG_TABLE.x - reach, y: PINGPONG_TABLE.height + 0.22, z: Math.max(PINGPONG_TABLE.z - 0.55, Math.min(PINGPONG_TABLE.z + 0.55, this.pos.z)) }
      : { x: PINGPONG_TABLE.x + reach, y: PINGPONG_TABLE.height + 0.22, z: Math.max(PINGPONG_TABLE.z - 0.55, Math.min(PINGPONG_TABLE.z + 0.55, this.pos.z)) };
    const spot = shotTarget(this.side, this.aim, this.depth);
    const shot = solveServe(from, spot, kind, power);

    this.ballInPlay = true;
    this.ballPos.set(from.x, from.y, from.z);
    this.ballVel.set(shot.vx, shot.vy, shot.vz);
    this.ballTops = shot.tops;
    this.ballSide = shot.side;
    this.lastHitter = this.side;
    this.lastBounceSide = null;
    this.netHold = 0;
    this.rally = 1;
    this.breakT = 0;

    this.cb.playSound('paddle');
    this.serveFlight = true;
    this.cb.sendServe(this.side, shot.vx, shot.vy, shot.vz, { tops: shot.tops, side: shot.side, kind }, from);
  }

  /**
   * Takes the ball as the floor has it, when the other player struck it: both players fly the same
   * ball from the same state, so a rally looks the same from either end of the table.
   */
  adopt(ball: PingPongBallState | undefined, rally = this.state.rally) {
    if (!ball || ball.t <= this.seenAt) return;
    this.seenAt = ball.t;
    this.serveFlight = rally <= 1;
    this.ballPos.set(ball.x, ball.y, ball.z);
    this.ballVel.set(ball.vx, ball.vy, ball.vz);
    this.ballTops = ball.tops ?? 0;
    this.ballSide = ball.side ?? 0;
    this.lastStroke = ball.kind ?? 'drive';
    this.ballInPlay = true;
    this.lastBounceSide = null;
    this.netHold = 0;
    this.breakT = 0;
    this.rally++;
    this.lastHitter = ball.vx >= 0 ? 'west' : 'east';
  }

  update(dt: number, state: PingPongState) {
    const c = this.court();
    if (!c) return;
    this.state = state;
    if (!this.active) return;

    this.recovering = Math.max(0, this.recovering - dt);
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
    if (this.mode !== 'pvp') this.updateBot(dt);
    if (this.ballInPlay) {
      this.updateBallPhysics(dt);
    } else {
      // Between points: the ball waits on the server's bat, and the next serve is theirs.
      this.breakT += dt;
      const theirs = state.serving?.side ?? state.server;
      const at = theirs === this.side ? this.bat : this.oppBat;
      c.setBall(at.x, at.y, at.z, true);
      // The bot serves its own serve, once the break is over.
      if (this.mode !== 'pvp' && this.automatesOpponent && theirs === this.opponent && this.readyToServe && state.active && ['serve', 'point'].includes(state.status)) {
        this.serveBot(state.serving?.kind ?? 'topspin');
      }
    }
  }

  /** How long the break between points lasts before the next serve can be played (s). */
  get readyToServe(): boolean {
    return !this.ballInPlay && this.breakT >= PINGPONG_MATCH.breakSeconds;
  }

  /** Whether it is this side's serve to play. */
  serving(state: PingPongState): boolean {
    return state.active && ['serve', 'point'].includes(state.status) && (state.serving?.side ?? state.server) === this.side && this.readyToServe;
  }

  /** The stroke the floor has put up for the serve. */
  serveKind(state: PingPongState): PingPongShotKind {
    return state.serving?.kind ?? 'topspin';
  }

  private updateBot(dt: number) {
    const flight = this.ballInPlay
      ? { x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z, vx: this.ballVel.x, vy: this.ballVel.y, vz: this.ballVel.z, tops: this.ballTops, side: this.ballSide }
      : null;
    this.bot.look(flight ? this.rally : null, dt);
    this.botPlan = this.bot.plan(flight, this.opponent, this.pos, this.lastBounceSide === this.opponent);
    this.bot.step(dt, this.botPlan.to);

    if (!this.automatesOpponent) return;
    const toward = this.opponent === 'east' ? 1 : -1;
    if (!this.ballInPlay || this.lastHitter === this.opponent || this.lastBounceSide !== this.opponent || Math.sign(this.ballVel.x) !== toward || this.oppSwinging) return;
    const bat = this.oppBat;
    if (!this.bot.canMeet({ ...this.ballPos, vx: this.ballVel.x, vy: this.ballVel.y, vz: this.ballVel.z, tops: this.ballTops, side: this.ballSide }, this.botPlan)) return;
    if (!this.batCanReach(bat)) return;
    this.oppSwinging = true;
    this.oppSwingProgress = 0;
    this.hit(this.opponent, this.botPlan.stroke ?? 'topspin', this.botPlan.aim ? (this.botPlan.aim.z - PINGPONG_TABLE.z) / (PINGPONG_TABLE.width / 2 - PINGPONG_PHYSICS.edgeMargin) : 0, this.botPlan.depth, this.botPlan.power);
  }

  /**
   * Whether a bat held at `bat` meets the ball: the closest the ball came to it over the whole of
   * this frame, not just where it ended up. On a slow frame the ball steps most of a metre, and a
   * bat that only looked at the end of it would swing through where the ball had been.
   */
  private batCanReach(bat: { x: number; y: number; z: number }, reach = PINGPONG_COURT.lunge): boolean {
    const dx = this.ballPos.x - this.ballPrev.x;
    const dy = this.ballPos.y - this.ballPrev.y;
    const dz = this.ballPos.z - this.ballPrev.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((bat.x - this.ballPrev.x) * dx + (bat.y - this.ballPrev.y) * dy + (bat.z - this.ballPrev.z) * dz) / len2));
    const py = this.ballPrev.y + dy * t;
    if (Math.abs(py - bat.y) > 0.45) return false;
    return Math.hypot(this.ballPrev.x + dx * t - bat.x, this.ballPrev.z + dz * t - bat.z) < reach;
  }

  private updateBallPhysics(dt: number) {
    const c = this.court();
    if (!c) return;

    // Step small enough that the ball cannot skip the net or the far edge on a slow frame.
    const steps = Math.min(64, Math.max(1, Math.ceil(dt / 0.008)));
    const h = dt / steps;
    const flight = { x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z, vx: this.ballVel.x, vy: this.ballVel.y, vz: this.ballVel.z, tops: this.ballTops, side: this.ballSide };
    for (let i = 0; i < steps; i++) {
      if (!this.ballInPlay) return;
      const before = { x: flight.x, y: flight.y, z: flight.z };
      flyStep(flight, h);
      this.netHold = Math.max(0, this.netHold - h);

      // The net, once: it stops the ball dead rather than flipping it back and forth every frame.
      if (this.netHold <= 0 && netContact(before, flight)) {
        flight.x = PINGPONG_TABLE.x - Math.sign(flight.vx || 1) * (PINGPONG_PHYSICS.ballRadius + 0.01);
        flight.vx *= -0.2;
        flight.vy *= 0.4;
        this.netHold = NET_HOLD;
        this.cb.playSound('net');
        this.ballPos.set(flight.x, flight.y, flight.z);
        continue;
      }

      if (before.y >= PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius && flight.y <= PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius && flight.vy < 0) {
        const side = inTableHalf('west', flight.x, flight.z) ? 'west' : inTableHalf('east', flight.x, flight.z) ? 'east' : null;
        if (side) {
          flight.y = PINGPONG_TABLE.height + PINGPONG_PHYSICS.ballRadius;
          tableBounce(flight);
          this.ballVel.set(flight.vx, flight.vy, flight.vz);
          this.ballTops = flight.tops;
          this.ballSide = flight.side;
          this.cb.playSound('table');
          if (this.lastBounceSide === side) {
            // Two bounces on one half: the player on that half loses the point.
            this.ballInPlay = false;
            this.ballPos.set(flight.x, flight.y, flight.z);
            this.cb.playSound('point');
            this.cb.awardPoint(otherSide(side), 'Double bounce');
            return;
          }
          if (this.lastBounceSide === null && side === this.lastHitter && !this.serveFlight) {
            this.ballInPlay = false;
            this.cb.awardPoint(otherSide(side), 'Return bounced on your own half');
            return;
          }
          if (this.serveFlight && this.lastBounceSide === null && side !== this.lastHitter) {
            this.ballInPlay = false;
            this.cb.awardPoint(otherSide(this.lastHitter!), 'Serve missed the first bounce');
            return;
          }
          this.lastBounceSide = side;
          this.ballPos.set(flight.x, flight.y, flight.z);
          continue;
        }
      }

      if (flight.y <= 0) {
        this.ballInPlay = false;
        this.ballPos.set(flight.x, flight.y, flight.z);
        this.cb.playSound('point');
        // Bounced on the far side and never returned is the striker's point; anything else is not.
        const winner = this.lastBounceSide && this.lastHitter && this.lastBounceSide !== this.lastHitter ? this.lastHitter : this.lastHitter ? otherSide(this.lastHitter) : otherSide(this.side);
        this.cb.awardPoint(winner, 'Out');
        return;
      }
    }
    // The flight carries the velocity on to the next frame: gravity has to keep pulling between them.
    this.ballPos.set(flight.x, flight.y, flight.z);
    this.ballVel.set(flight.vx, flight.vy, flight.vz);
    this.ballTops = flight.tops;
    this.ballSide = flight.side;
    c.setBall(this.ballPos.x, this.ballPos.y, this.ballPos.z, true);
  }
}