/**
 * Table tennis on the extended balcony: stepping up to the table, swinging paddles,
 * rallying against an AI worker bot or multiplayer PvP, live score and sound effects.
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import type { PeerInfo } from '../../../shared/protocol';
import { playTableTennisSound } from './sound';
import { openTableTennisDialog } from './ui';
import { standingSpot, TableTennisBats, TableTennisOpponent } from './avatar';
import { TableTennisController } from './controller';
import type { TableTennisCourt3D } from './world';
import { facingTable, PINGPONG_STROKES, PINGPONG_STROKES_ORDER, scoreLine, type BotDifficulty, type PingPongMode, type PingPongPlayer, type PingPongShotKind, type PingPongSide } from '../../../shared/tabletennis';

// Augment InteractKinds with 'pingpong' (lowercase letters only per registry rules)
declare module '../../world/types' {
  interface InteractKinds {
    pingpong: true;
  }
}

export interface TableTennisDeps {
  standUp?(): void;
  stopWalking?(): void;
}

export function installTableTennis(ctx: Ctx, deps: TableTennisDeps = {}) {
  const court = (): TableTennisCourt3D | undefined => ctx.office.tableTennis;
  const STROKES = PINGPONG_STROKES_ORDER;
  let bats: TableTennisBats | undefined;
  let opponent: TableTennisOpponent | undefined;

  const controller = new TableTennisController(
    ctx.player,
    court,
    {
      sendServe(side: PingPongSide, vx: number, vy: number, vz: number) {
        ctx.net.send({ t: 'pingpong.serve', side, vx, vy, vz });
      },
      sendHit(side: PingPongSide, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
        ctx.net.send({ t: 'pingpong.hit', side, x, y, z, vx, vy, vz });
      },
      awardPoint(winner: PingPongSide, reason?: string) {
        ctx.net.send({ t: 'pingpong.point', winner, reason });
      },
      playSound(kind) {
        ctx.sound.tableTennis(kind);
      },
      onDone() {
        if (court()?.group.userData.interact) court()!.group.userData.interact.off = false;
        ctx.hint.invalidate();
      },
    },
  );

  /** Stands the other player up at their end: a worker bot for a bot match, or nobody in PvP
   * (the other player's own body is in the room with you, at the same place). */
  function opponentDown() {
    opponent?.dispose(ctx.scene);
    opponent = undefined;
  }

  // Register player activity: hide first-person hands/body (table tennis renders 3D paddle)
  ctx.activities.add({
    id: 'tabletennis',
    active: () => controller.active,
    stop: (why) => {
      if (why !== 'taken') {
        controller.stop();
        ctx.net.send({ t: 'pingpong.leave' });
      }
    },
    key: (e) => {
      if (e.code === 'KeyE' || e.code === 'Escape') {
        controller.stop();
        ctx.net.send({ t: 'pingpong.leave' });
        return true;
      }
      // The stroke you play: the modifier keys pick it, and Tab cycles when you'd rather not hold them.
      if (e.code === 'Space') {
        controller.swing(strokeFor(e));
        return true;
      }
      if (e.code === 'Tab') {
        controller.stroke = STROKES[(STROKES.indexOf(controller.stroke) + 1) % STROKES.length];
        toast(`🏓 ${PINGPONG_STROKES[controller.stroke].label}`, 'info');
        ctx.hint.invalidate();
        return true;
      }
      // Walking round your own end. The office's own movement keys don't move you while you play:
      // you are on the court, not wandering the balcony.
      if (e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'KeyW' || e.code === 'KeyS') return true;
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && !(e.code in DESK_KEYS)) return false;
      return true;
    },
    hint: (el) => renderPlayHint(el, controller.stroke),
    // Your own body and hands stay: you are stood at the table holding a bat, not a floating one.
    bothHands: true,
  });

  // Left click swings paddle while playing table tennis
  const ordinaryClick = ctx.player.onClick;
  ctx.player.onClick = (ndc) => {
    if (controller.active) {
      controller.swing(controller.stroke);
      return;
    }
    ordinaryClick?.(ndc);
  };

  window.addEventListener('mousedown', (e) => {
    if (controller.active && e.button === 0) controller.swing(strokeFor(e));
  });

  /** The stroke a swing plays: Shift smashes, Control cuts, otherwise whatever you last picked. */
  function strokeFor(e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): PingPongShotKind {
    if (e.shiftKey) return 'smash';
    if (e.ctrlKey || e.metaKey) return 'backspin';
    return controller.stroke;
  }

  // Play tick
  ctx.ticks.add('play', ({ dt, t }) => {
    if (controller.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.activities.running('climber') || ctx.player.seat)) {
      controller.stop();
      ctx.net.send({ t: 'pingpong.leave' });
    }
    // Your feet: the walk keys, on your own end of the table.
    if (controller.active) {
      const held = (a: string, b: string) => (ctx.player.holding(a) ? 1 : 0) - (ctx.player.holding(b) ? 1 : 0);
      controller.move(dt, held('KeyD', 'KeyA'), held('KeyW', 'KeyS'));
      ctx.player.pos.set(controller.where.x, 0, controller.where.z);
      ctx.player.facing = facingTable(controller.where.x, controller.where.z);
      ctx.player.camYaw = ctx.player.facing - Math.PI;
    }
    controller.update(dt, store.pingpong);
    if (!controller.active) return;
    // Both bats, in the hands of the players who are actually holding them.
    const far = farPlayer(controller.opponent);
    const oppAt = far.peer ? { x: far.peer.x, z: far.peer.z } : controller.oppWhere;
    (bats ??= new TableTennisBats(court, controller.side)).update(
      controller.bat,
      { x: oppAt.x + (controller.opponent === 'west' ? 1 : -1) * 0.46, y: 1.04, z: oppAt.z + (controller.opponent === 'west' ? 0.26 : -0.26) },
      controller.swinging ? controller.swingProgress : -1,
      controller.oppSwinging ? controller.oppSwingProgress : -1,
    );
    // The far player moves to the ball, so their body walks about their end too.
    opponent?.update(dt, t, controller.oppSwinging ? controller.oppSwingProgress : -1, oppAt);
  });

  /** Whoever is on the far side of the net: their body in the room, if they're a person here. */
  function farPlayer(side: PingPongSide): { peer?: PeerInfo; bot?: PingPongPlayer } {
    const s = store.pingpong;
    const who = side === 'west' ? s.westPlayer : s.eastPlayer;
    if (!who) return {};
    if (who.isBot) return { bot: who };
    const peer = store.peers.get(who.id);
    return peer && store.onMyFloor(peer) ? { peer } : {};
  }

  /** Stands the worker bot up at its end of the table; in PvP the other player's body is already here. */
  function syncOpponent() {
    const { bot } = farPlayer(controller.opponent);
    if (bot && !opponent) opponent = new TableTennisOpponent(ctx.scene, bot.name, '#06d6a0', controller.opponent);
    if (!bot && opponent) opponentDown();
  }

  // Listen to remote server events
  ctx.messages.on('pingpong.state', () => {
    const s = store.pingpong;
    court()?.updateScore(`🏓 ${scoreLine(s)}`);
    // The other player struck it: fly the same ball from where the floor has it, so a rally is the
    // same rally from both ends of the table.
    controller.adopt(s.ball);
    if (controller.active) syncOpponent();
  });

  ctx.messages.on('pingpong.hit', (m) => {
    // If not local player's hit, play remote sound
    if (!controller.active || m.side !== controller.side) {
      ctx.sound.tableTennis('paddle', { x: m.x, y: m.y, z: m.z });
    }
  });

  ctx.messages.on('pingpong.point', (m) => {
    ctx.sound.tableTennis(m.sound === 'win' ? 'win' : 'point');
    toast(m.text, 'info');
  });

  // Table Tennis interactable
  ctx.interactions.define('pingpong', {
    reach: 3.6,
    hint: () => ({
      k: 'pingpong',
      parts: [hintTitle('🏓 Table Tennis'), aside('balcony court'), key('E', 'Play Table Tennis')],
    }),
    use: onE(() => {
      deps.standUp?.();
      deps.stopWalking?.();

      const workers = Array.from(store.workers.values()).map((w) => w.name);
      openTableTennisDialog({
        state: store.pingpong,
        workers,
        currentUserId: store.you,
        onJoin(side: PingPongSide, mode: PingPongMode, botName?: string, difficulty?: BotDifficulty) {
          if (court()?.group.userData.interact) court()!.group.userData.interact.off = true;
          ctx.net.send({ t: 'pingpong.join', side, mode, botName, difficulty });
          controller.start(side, mode, difficulty);
          bats = new TableTennisBats(court, side);
          if (mode === 'bot') opponent = new TableTennisOpponent(ctx.scene, botName || 'Worker Bot', '#06d6a0', controller.opponent);
        },
        onLeave() {
          controller.stop();
          bats = undefined;
          opponentDown();
          ctx.net.send({ t: 'pingpong.leave' });
        },
        onReset() {
          ctx.net.send({ t: 'pingpong.reset' });
        },
      });
    }),
  });
}

function renderPlayHint(el: HTMLElement, stroke: PingPongShotKind) {
  el.replaceChildren(
    h('span.hint-title', {}, '🏓 Table Tennis'),
    h('span.hint-key', {}, '[W A S D]'),
    ' Footwork · ',
    h('span.hint-key', {}, '[Space]'),
    ` ${PINGPONG_STROKES[stroke].label}`,
    ' (',
    h('span.hint-key', {}, '[Shift]'),
    ' Smash · ',
    h('span.hint-key', {}, '[Ctrl]'),
    ' Chop · ',
    h('span.hint-key', {}, '[Tab]'),
    ' Change) · ',
    h('span.hint-key', {}, '[E / Esc]'),
    ' Step Back',
  );
}
