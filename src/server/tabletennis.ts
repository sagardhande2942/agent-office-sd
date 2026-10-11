/**
 * Table tennis match management on the server: handles match state per floor,
 * player joining/leaving (PvP and Worker Bot), score tracking, and bot returns.
 */
import {
  afterPoint,
  type BotDifficulty,
  type PingPongBallState,
  type PingPongMode,
  type PingPongShotKind,
  type PingPongSide,
  type PingPongState,
  defaultPingPongState,
  otherSide,
    PINGPONG_PHYSICS,
  PINGPONG_TABLE,
} from '../shared/tabletennis.js';

export interface FloorTableTennis {
  state(): PingPongState;
  join(playerId: string, playerName: string, side: PingPongSide, mode: PingPongMode, botName?: string, difficulty?: BotDifficulty): boolean;
  leave(playerId: string): boolean;
  serve(playerId: string, side: PingPongSide, vx: number, vy: number, vz: number, spin?: { tops: number; side: number; kind?: PingPongShotKind }): { ball: PingPongBallState; state: PingPongState } | null;
  hit(playerId: string, side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number, spin?: { tops: number; side: number; kind?: PingPongShotKind }): { ball: PingPongBallState; state: PingPongState } | null;
  awardPoint(playerId: string, winner: PingPongSide, reason?: string): { score: { west: number; east: number }; games: { west: number; east: number }; winner: PingPongSide; text: string; matchWon?: boolean; gameWon?: boolean } | null;
  reset(): boolean;
}

/**
 * A shot as the floor will accept it from a client: sent from the striker's own half towards the
 * other, and within the speeds a ball can actually be hit at. A client that sends a shot of its own
 * inventing — or one aimed at the players behind it — has it corrected rather than obeyed.
 */
function clampSpin(v: number): number {
  return Number.isFinite(v) ? Math.max(-3, Math.min(3, v)) : 0;
}

function clampedShot(side: PingPongSide, vx: number, vy: number, vz: number): { vx: number; vy: number; vz: number } {
  const limit = 8;
  const finite = (v: number, fallback: number) => (Number.isFinite(v) ? fallback : v);
  const away = side === 'west' ? 1 : -1;
  const speed = Math.max(-limit, Math.min(limit, finite(vx, away * PINGPONG_PHYSICS.shotSpeed) * away) * away);
  return {
    vx: speed,
    vy: Math.max(-limit, Math.min(limit, finite(vy, 2))),
    vz: Math.max(-limit, Math.min(limit, finite(vz, 0))),
  };
}

export class TableTennisMatch implements FloorTableTennis {
  private current: PingPongState = defaultPingPongState();

  state(): PingPongState {
    return { ...this.current };
  }

  join(playerId: string, playerName: string, side: PingPongSide, mode: PingPongMode, botName = 'Worker Bot', difficulty: BotDifficulty = 'normal'): boolean {
    if (mode === 'bot') {
      this.current = {
        active: true,
        mode: 'bot',
        score: { west: 0, east: 0 },
        games: { west: 0, east: 0 },
        server: side,
        rally: 0,
        status: 'serve',
        serving: { side, kind: 'topspin' },
        [side === 'west' ? 'westPlayer' : 'eastPlayer']: { id: playerId, name: playerName },
        [otherSide(side) === 'west' ? 'westPlayer' : 'eastPlayer']: {
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
        games: { west: 0, east: 0 },
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
      this.current.serving = { side: this.current.server, kind: 'topspin' };
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

  serve(playerId: string, side: PingPongSide, vx: number, vy: number, vz: number, spin?: { tops: number; side: number; kind?: PingPongShotKind }): { ball: PingPongBallState; state: PingPongState } | null {
    if (!this.current.active) return null;
    if (this.current.server !== side) return null;
    const player = side === 'west' ? this.current.westPlayer : this.current.eastPlayer;
    // The worker bot's serves are played by the client that is playing it.
    if (!player || (player.id !== playerId && !player.isBot)) return null;

    const startX = side === 'west' ? PINGPONG_TABLE.x - 1.2 : PINGPONG_TABLE.x + 1.2;
    const ball: PingPongBallState = {
      x: startX,
      y: PINGPONG_TABLE.height + 0.25,
      z: PINGPONG_TABLE.z,
      ...clampedShot(side, vx, vy, vz),
      tops: clampSpin(spin?.tops ?? 0),
      side: clampSpin(spin?.side ?? 0),
      kind: spin?.kind ?? 'topspin',
      t: Date.now(),
    };

    this.current.ball = ball;
    this.current.lastHitBy = side;
    delete this.current.serving;
    this.current.status = 'rally';
    this.current.rally = 1;
    return { ball, state: this.state() };
  }

  hit(playerId: string, side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number, spin?: { tops: number; side: number; kind?: PingPongShotKind }): { ball: PingPongBallState; state: PingPongState } | null {
    if (!this.current.active) return null;
    const player = side === 'west' ? this.current.westPlayer : this.current.eastPlayer;
    if (!player || (player.id !== playerId && !player.isBot)) return null;

    const ball: PingPongBallState = {
      x: Number.isFinite(x) ? x : PINGPONG_TABLE.x,
      y: Number.isFinite(y) ? y : PINGPONG_TABLE.height,
      z: Number.isFinite(z) ? z : PINGPONG_TABLE.z,
      ...clampedShot(side, vx, vy, vz),
      tops: clampSpin(spin?.tops ?? 0),
      side: clampSpin(spin?.side ?? 0),
      kind: spin?.kind ?? 'drive',
      t: Date.now(),
    };

    this.current.ball = ball;
    this.current.lastHitBy = side;
    this.current.status = 'rally';
    this.current.rally++;
    return { ball, state: this.state() };
  }

  /** Whether `playerId` is one of the two in this match, the worker bot included. */
  private plays(playerId: string): boolean {
    const { westPlayer, eastPlayer } = this.current;
    return [westPlayer?.id, eastPlayer?.id].includes(playerId);
  }

  /**
   * Scores the point a client saw end. The floor only takes a point from someone playing this match,
   * once the rally they are claiming has actually been struck (`lastHitBy`), and once only: the strike
   * is spent as the point is scored, so a replayed message cannot keep handing out points. Anything
   * else — a stranger's client, a claim on a rally with nobody's bat in it — is refused.
   */
  awardPoint(playerId: string, winner: PingPongSide, reason = ''): { score: { west: number; east: number }; games: { west: number; east: number }; winner: PingPongSide; text: string; matchWon?: boolean; gameWon?: boolean } | null {
    if (!this.current.active) return null;
    if (!this.plays(playerId)) return null;
    if (!this.current.lastHitBy) return null;

    const next = afterPoint(this.current, winner);
    const was = { ...this.current.score };
    this.current.score = next.score;
    this.current.games = next.games;
    this.current.server = next.server;

    if (next.matchWon) {
      this.current.status = 'ended';
      this.current.winner = winner;
    } else {
      this.current.status = 'point';
      this.current.serving = { side: next.server, kind: 'topspin' };
    }

    // The rally is over and the strike that ended it is spent: the next claim needs a new one.
    delete this.current.ball;
    delete this.current.lastHitBy;
    delete this.current.lastBounceSide;
    this.current.rally = 0;

    const winnerName = (winner === 'west' ? this.current.westPlayer?.name : this.current.eastPlayer?.name) ?? winner;
    const games = `${next.games.west} - ${next.games.east}`;
    const points = `${next.score.west} - ${next.score.east}`;
    const text = next.matchWon
      ? `🏆 ${winnerName} won the match ${games}!`
      : next.gameWon
        ? `🏅 ${winnerName} took the game ${games} · that game was ${was.west} - ${was.east}`
        : `🏓 Point for ${winnerName}! (${points})${reason ? ` · ${reason}` : ''}`;

    return {
      score: next.score,
      games: next.games,
      winner,
      text,
      matchWon: next.matchWon,
      gameWon: next.gameWon,
    };
  }

  reset(): boolean {
    if (!this.current.active) return false;
    this.current.score = { west: 0, east: 0 };
    this.current.games = { west: 0, east: 0 };
    this.current.rally = 0;
    this.current.status = 'serve';
    this.current.serving = { side: this.current.server, kind: 'topspin' };
    delete this.current.ball;
    delete this.current.winner;
    return true;
  }
}
