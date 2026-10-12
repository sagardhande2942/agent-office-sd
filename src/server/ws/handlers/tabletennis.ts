/**
 * WebSocket handlers for table tennis on the balcony.
 */
import type { FloorActions as Floor } from '../../floor-actions.js';
import type { TableTennisClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { num, str } from '../../office/input.js';
import { defaultPingPongState, type PingPongBallState, type PingPongShotKind, type PingPongSide } from '../../../shared/tabletennis.js';
import type { PingPongSwing } from '../../../shared/protocol/tabletennis.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

export const tableTennisView: ViewPieces['pingpong'] = (_ctx, floor) =>
  floor?.pingpong?.state() ?? defaultPingPongState();

export const tableTennisChanged = (ctx: Ctx, floor: Floor) =>
  ctx.toFloor(floor, { t: 'pingpong.state', state: floor.pingpong?.state() ?? defaultPingPongState() });

/** A client's stroke, as far as the floor will take it: a known stroke, and spin inside its range. */
function spinOf(swing?: PingPongSwing): { tops: number; side: number; kind: PingPongShotKind } | undefined {
  if (!swing) return undefined;
  const kinds: PingPongShotKind[] = ['drive', 'topspin', 'backspin', 'smash'];
  return {
    tops: Math.max(-3, Math.min(3, num(swing.tops))),
    side: Math.max(-3, Math.min(3, num(swing.side))),
    kind: kinds.includes(swing.kind) ? swing.kind : 'drive',
  };
}

/** The stroke and spin a ball is carrying, for everyone watching. */
function swingOf(ball: PingPongBallState): PingPongSwing {
  return { tops: ball.tops, side: ball.side, kind: ball.kind };
}

export const tableTennisHandlers = {
  async 'pingpong.join'(ctx: Ctx, c: Client, msg: { t: 'pingpong.join'; side: PingPongSide; mode: 'bot' | 'pvp' | 'bots'; botName?: string; difficulty?: 'easy' | 'normal' | 'pro'; westDifficulty?: 'easy' | 'normal' | 'pro' }) {
    const floor = ctx.floorOf(c);
    if (!floor?.pingpong) return;
    const side: PingPongSide = msg.side === 'east' ? 'east' : 'west';
    const mode = msg.mode === 'bots' ? 'bots' : msg.mode === 'pvp' ? 'pvp' : 'bot';
    const botName = msg.botName ? str(msg.botName, 40) : 'Worker Bot';
    const difficulty = msg.difficulty === 'easy' || msg.difficulty === 'pro' ? msg.difficulty : 'normal';

    const ok = floor.pingpong.join(c.id, c.peer.name, side, mode, botName, difficulty, msg.westDifficulty === 'easy' || msg.westDifficulty === 'pro' ? msg.westDifficulty : 'normal');
    if (ok) {
      tableTennisChanged(ctx, floor);
      const opponent = mode === 'bots' ? 'two worker bots' : mode === 'bot' ? botName : 'another player';
      ctx.toastFloor(floor, mode === 'bots' ? `🏓 ${c.peer.name} is watching the bot match` : `🏓 ${c.peer.name} stepped to the table tennis board (vs ${opponent})`);
    }
  },

  async 'pingpong.leave'(ctx: Ctx, c: Client) {
    const floor = ctx.floorOf(c);
    if (!floor?.pingpong) return;
    const changed = floor.pingpong.leave(c.id);
    if (changed) {
      tableTennisChanged(ctx, floor);
    }
  },

  async 'pingpong.serve'(ctx: Ctx, c: Client, msg: { t: 'pingpong.serve'; side: PingPongSide; vx: number; vy: number; vz: number; swing?: PingPongSwing; origin?: { x: number; y: number; z: number } }) {
    const floor = ctx.floorOf(c);
    if (!floor?.pingpong) return;
    const side: PingPongSide = msg.side === 'east' ? 'east' : 'west';
    const result = floor.pingpong.serve(c.id, side, num(msg.vx), num(msg.vy), num(msg.vz), spinOf(msg.swing), msg.origin ? { x: num(msg.origin.x), y: num(msg.origin.y), z: num(msg.origin.z) } : undefined);
    if (result) {
      ctx.toFloor(floor, {
        t: 'pingpong.hit',
        side,
        x: result.ball.x,
        y: result.ball.y,
        z: result.ball.z,
        vx: result.ball.vx,
        vy: result.ball.vy,
        vz: result.ball.vz,
        swing: swingOf(result.ball),
      });
      tableTennisChanged(ctx, floor);
    }
  },

  async 'pingpong.hit'(ctx: Ctx, c: Client, msg: { t: 'pingpong.hit'; side: PingPongSide; x: number; y: number; z: number; vx: number; vy: number; vz: number; swing?: PingPongSwing }) {
    const floor = ctx.floorOf(c);
    if (!floor?.pingpong) return;
    const side: PingPongSide = msg.side === 'east' ? 'east' : 'west';
    const result = floor.pingpong.hit(c.id, side, num(msg.x), num(msg.y), num(msg.z), num(msg.vx), num(msg.vy), num(msg.vz), spinOf(msg.swing));
    if (result) {
      ctx.toFloor(floor, {
        t: 'pingpong.hit',
        side,
        x: result.ball.x,
        y: result.ball.y,
        z: result.ball.z,
        vx: result.ball.vx,
        vy: result.ball.vy,
        vz: result.ball.vz,
        swing: swingOf(result.ball),
      });
      tableTennisChanged(ctx, floor);
    }
  },

  async 'pingpong.point'(ctx: Ctx, c: Client, msg: { t: 'pingpong.point'; winner: PingPongSide; reason?: string }) {
    const floor = ctx.floorOf(c);
    if (!floor?.pingpong) return;
    const winner: PingPongSide = msg.winner === 'east' ? 'east' : 'west';
    const res = floor.pingpong.awardPoint(c.id, winner, msg.reason ? str(msg.reason, 60) : undefined);
    if (res) {
      ctx.toFloor(floor, {
        t: 'pingpong.point',
        winner: res.winner,
        score: res.score,
        games: res.games,
        text: res.text,
        sound: res.matchWon ? 'win' : res.gameWon ? 'game' : 'point',
      });
      tableTennisChanged(ctx, floor);
    }
  },

  async 'pingpong.reset'(ctx: Ctx, c: Client) {
    const floor = ctx.floorOf(c);
    if (!floor?.pingpong) return;
    const state = floor.pingpong.state();
    if (state.mode === 'bots' && state.operatorId !== c.id) return;
    if (floor.pingpong.reset()) {
      tableTennisChanged(ctx, floor);
    }
  },
} satisfies HandlerMap<TableTennisClientMsg>;

export const tableTennisHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    if (was?.pingpong?.leave(c.id)) {
      return () => tableTennisChanged(ctx, was);
    }
  },
  closedOn(ctx, c, floor) {
    if (floor.pingpong?.leave(c.id)) {
      tableTennisChanged(ctx, floor);
    }
  },
};
