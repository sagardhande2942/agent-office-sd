/**
 * Table tennis on the extended balcony: stepping up to the table, swinging paddles,
 * rallying against an AI worker bot or multiplayer PvP, live score and sound effects.
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { playTableTennisSound } from './sound';
import { openTableTennisDialog } from './ui';
import { TableTennisController } from './controller';
import type { TableTennisCourt3D } from './world';
import type { BotDifficulty, PingPongMode, PingPongSide } from '../../../shared/tabletennis';

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
    () => ctx.me,
  );

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
      if (e.code === 'Space') {
        controller.swing();
        return true;
      }
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        controller.shiftPaddle(0.08);
        return true;
      }
      if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        controller.shiftPaddle(-0.08);
        return true;
      }
      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        controller.shiftPaddle(0, 0.06);
        return true;
      }
      if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        controller.shiftPaddle(0, -0.06);
        return true;
      }
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && !(e.code in DESK_KEYS)) return false;
      return true;
    },
    hint: (el) => renderPlayHint(el),
    hidesHands: true,
    bothHands: true,
  });

  // Left click swings paddle while playing table tennis
  const ordinaryClick = ctx.player.onClick;
  ctx.player.onClick = (ndc) => {
    if (controller.active) {
      controller.swing();
      return;
    }
    ordinaryClick?.(ndc);
  };

  window.addEventListener('mousedown', (e) => {
    if (controller.active && e.button === 0) {
      controller.swing();
    }
  });

  // Play tick
  ctx.ticks.add('play', ({ dt }) => {
    if (controller.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.activities.running('climber') || ctx.player.seat)) {
      controller.stop();
      ctx.net.send({ t: 'pingpong.leave' });
    }
    controller.update(dt, store.pingpong);
  });

  // Listen to remote server events
  ctx.messages.on('pingpong.state', () => {
    const s = store.pingpong;
    court()?.updateScore(`🏓 ${s.score.west} - ${s.score.east}`);
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
        },
        onLeave() {
          controller.stop();
          ctx.net.send({ t: 'pingpong.leave' });
        },
        onReset() {
          ctx.net.send({ t: 'pingpong.reset' });
        },
      });
    }),
  });
}

function renderPlayHint(el: HTMLElement) {
  el.replaceChildren(
    h('span.hint-title', {}, '🏓 Table Tennis'),
    h('span.hint-key', {}, '[Space / Click]'),
    ' Swing · ',
    h('span.hint-key', {}, '[A/D]'),
    ' Move · ',
    h('span.hint-key', {}, '[E / Esc]'),
    ' Step Back',
  );
}
