/**
 * Table tennis match management on the server: handles match state per floor,
 * player joining/leaving (PvP and Worker Bot), score tracking, and bot returns.
 */
import {
  type BotDifficulty,
  type PingPongBallState,
  type PingPongMode,
  type PingPongSide,
  type PingPongState,
  defaultPingPongState,
  PINGPONG_PHYSICS,
  PINGPONG_TABLE,
} from '../shared/tabletennis.js';

export interface FloorTableTennis {
  state(): PingPongState;
  join(playerId: string, playerName: string, side: PingPongSide, mode: PingPongMode, botName?: string, difficulty?: BotDifficulty): boolean;
  leave(playerId: string): boolean;
  serve(playerId: string, side: PingPongSide, vx: number, vy: number, vz: number): { ball: PingPongBallState; state: PingPongState } | null;
  hit(playerId: string, side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number): { ball: PingPongBallState; state: PingPongState } | null;
  awardPoint(winner: PingPongSide, reason?: string): { score: { west: number; east: number }; winner: PingPongSide; text: string; matchWon?: boolean } | null;
  reset(): boolean;
  computeBotReturn(difficulty?: BotDifficulty): { vx: number; vy: number; vz: number; delay: number } | null;
}

export class TableTennisMatch implements FloorTableTennis {
  private current: PingPongState = defaultPingPongState();

  state(): PingPongState {
    return { ...this.current };
  }

  join(playerId: string, playerName: string, side: PingPongSide, mode: PingPongMode, botName = 'Worker Bot', difficulty: BotDifficulty = 'normal'): boolean {
    if (mode === 'bot') {
      const otherSide: PingPongSide = side === 'west' ? 'east' : 'west';
      this.current = {
        active: true,
        mode: 'bot',
        score: { west: 0, east: 0 },
        server: side,
        rally: 0,
        status: 'serve',
        [side === 'west' ? 'westPlayer' : 'eastPlayer']: { id: playerId, name: playerName },
        [otherSide === 'west' ? 'westPlayer' : 'eastPlayer']: {
          id: 'bot',
          name: botName,
          isBot: true,
          botName,
          difficulty,
        },
      };
      return true;
    }

    // PvP mode: join as west or east
    if (!this.current.active || this.current.mode !== 'pvp') {
      this.current = {
        active: true,
        mode: 'pvp',
        score: { west: 0, east: 0 },
        server: 'west',
        rally: 0,
        status: 'waiting',
      };
    }

    if (side === 'west') {
      this.current.westPlayer = { id: playerId, name: playerName };
    } else {
      this.current.eastPlayer = { id: playerId, name: playerName };
    }

    if (this.current.westPlayer && this.current.eastPlayer) {
      this.current.status = 'serve';
    } else {
      this.current.status = 'waiting';
    }

    return true;
  }

  leave(playerId: string): boolean {
    let changed = false;
    if (this.current.westPlayer?.id === playerId) {
      delete this.current.westPlayer;
      changed = true;
    }
    if (this.current.eastPlayer?.id === playerId) {
      delete this.current.eastPlayer;
      changed = true;
    }

    if (changed) {
      if (this.current.mode === 'bot' || (!this.current.westPlayer && !this.current.eastPlayer)) {
        this.current = defaultPingPongState();
      } else {
        this.current.status = 'waiting';
        delete this.current.ball;
      }
    }
    return changed;
  }

  serve(playerId: string, side: PingPongSide, vx: number, vy: number, vz: number): { ball: PingPongBallState; state: PingPongState } | null {
    if (!this.current.active) return null;
    const player = side === 'west' ? this.current.westPlayer : this.current.eastPlayer;
    if (!player || player.id !== playerId) return null;

    const startX = side === 'west' ? PINGPONG_TABLE.x - 1.2 : PINGPONG_TABLE.x + 1.2;
    const ball: PingPongBallState = {
      x: startX,
      y: PINGPONG_TABLE.height + 0.25,
      z: PINGPONG_TABLE.z,
      vx,
      vy,
      vz,
      t: Date.now(),
    };

    this.current.ball = ball;
    this.current.lastHitBy = side;
    this.current.status = 'rally';
    this.current.rally = 1;
    return { ball, state: this.state() };
  }

  hit(playerId: string, side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number): { ball: PingPongBallState; state: PingPongState } | null {
    if (!this.current.active) return null;
    const player = side === 'west' ? this.current.westPlayer : this.current.eastPlayer;
    if (!player || (player.id !== playerId && !player.isBot)) return null;

    const ball: PingPongBallState = {
      x,
      y,
      z,
      vx,
      vy,
      vz,
      t: Date.now(),
    };

    this.current.ball = ball;
    this.current.lastHitBy = side;
    this.current.status = 'rally';
    this.current.rally++;
    return { ball, state: this.state() };
  }

  awardPoint(winner: PingPongSide, reason = ''): { score: { west: number; east: number }; winner: PingPongSide; text: string; matchWon?: boolean } | null {
    if (!this.current.active) return null;

    this.current.score[winner]++;
    const { west, east } = this.current.score;
    const totalPoints = west + east;

    // Check match victory (e.g. 11 points and win by 2)
    const pointsToWin = PINGPONG_PHYSICS.pointsToWin;
    const matchWon = (west >= pointsToWin || east >= pointsToWin) && Math.abs(west - east) >= 2;

    if (matchWon) {
      this.current.status = 'ended';
      this.current.winner = winner;
    } else {
      this.current.status = 'serve';
      // Rotate server every 2 points, or every point in deuce (>= 10-10)
      if (west >= 10 && east >= 10) {
        this.current.server = totalPoints % 2 === 0 ? 'west' : 'east';
      } else {
        this.current.server = Math.floor(totalPoints / 2) % 2 === 0 ? 'west' : 'east';
      }
    }

    delete this.current.ball;
    this.current.rally = 0;

    const winnerName = (winner === 'west' ? this.current.westPlayer?.name : this.current.eastPlayer?.name) ?? winner;
    const text = matchWon
      ? `🏆 ${winnerName} won the match (${west} - ${east})!`
      : `🏓 Point for ${winnerName}! (${west} - ${east})${reason ? ` · ${reason}` : ''}`;

    return {
      score: { west, east },
      winner,
      text,
      matchWon,
    };
  }

  reset(): boolean {
    if (!this.current.active) return false;
    this.current.score = { west: 0, east: 0 };
    this.current.rally = 0;
    this.current.status = 'serve';
    delete this.current.ball;
    delete this.current.winner;
    return true;
  }

  computeBotReturn(difficulty: BotDifficulty = 'normal'): { vx: number; vy: number; vz: number; delay: number } | null {
    // Return arc towards West half: target x in [4.8, 5.6], z in [14.6, 15.4]
    const zOffset = (Math.random() - 0.5) * (difficulty === 'easy' ? 0.8 : difficulty === 'normal' ? 0.6 : 0.4);
    const speedMultiplier = difficulty === 'easy' ? 0.85 : difficulty === 'normal' ? 1.0 : 1.25;

    // Ball traveling west (-x)
    const vx = (-4.8 - Math.random() * 0.8) * speedMultiplier;
    const vy = 3.2 + Math.random() * 0.4;
    const vz = zOffset * 2.5;
    const delay = difficulty === 'easy' ? 240 : difficulty === 'normal' ? 160 : 100;

    return { vx, vy, vz, delay };
  }
}
