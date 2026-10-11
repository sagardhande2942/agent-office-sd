import { h, openModal, type Modal } from '../../ui/dom';
import type { BotDifficulty, PingPongMode, PingPongSide, PingPongState } from '../../../shared/tabletennis';
import './ui.css';

export interface OpenTableTennisOpts {
  state: PingPongState;
  workers: string[];
  currentUserId?: string;
  onJoin: (side: PingPongSide, mode: PingPongMode, botName?: string, difficulty?: BotDifficulty) => void;
  onLeave: () => void;
  onReset: () => void;
}

let activeModal: Modal | null = null;

export function openTableTennisDialog(opts: OpenTableTennisOpts): Modal {
  if (activeModal) {
    activeModal.close();
  }

  let selectedDiff: BotDifficulty = 'normal';
  let selectedBot = opts.workers.length > 0 ? `${opts.workers[0]} (Worker Bot)` : 'Worker Bot 3000';

  const modalEl = h('div.modal.tabletennis-modal', {});

  // Header with title and description
  const header = h(
    'header.tabletennis-header',
    {},
    h('h2', {}, '🏓 Balcony Table Tennis'),
    h('p', {}, 'Regulation ping pong court on the extended balcony. Play against an AI worker bot or challenge another player!'),
  );

  // Scoreboard banner
  const scoreWest = opts.state.score.west;
  const scoreEast = opts.state.score.east;
  const westLabel = opts.state.westPlayer?.name ?? 'West';
  const eastLabel = opts.state.eastPlayer?.name ?? 'East';
  const scoreboard = h(
    'div.tabletennis-scoreboard-banner',
    {},
    h('div', {}, h('span', { style: 'font-weight:700;display:block;font-size:12px;opacity:0.8;' }, westLabel), h('span.tabletennis-score-val', {}, String(scoreWest))),
    h('div', { style: 'font-weight:900;font-size:20px;opacity:0.5;' }, 'VS'),
    h('div', {}, h('span', { style: 'font-weight:700;display:block;font-size:12px;opacity:0.8;' }, eastLabel), h('span.tabletennis-score-val', {}, String(scoreEast))),
  );

  // Section 1: Play vs Worker Bot
  const diffGroup = h(
    'div.tabletennis-btn-group',
    {},
    ...(['easy', 'normal', 'pro'] as BotDifficulty[]).map((d) => {
      const btn = h('button.tabletennis-diff-btn', { type: 'button' }, d.toUpperCase());
      if (d === selectedDiff) btn.classList.add('active');
      btn.onclick = () => {
        selectedDiff = d;
        diffGroup.querySelectorAll('.tabletennis-diff-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      };
      return btn;
    }),
  );

  const botCard = h(
    'div.tabletennis-card',
    {},
    h('div.tabletennis-card-title', {}, '🤖 Play vs Worker Bot', diffGroup),
    h('p.tabletennis-desc', {}, `Compete against an automated bot with custom returns, difficulty tuning, and reactions.`),
    h(
      'button.tabletennis-play-btn',
      {
        type: 'button',
        onclick: () => {
          modal.close();
          opts.onJoin('west', 'bot', selectedBot, selectedDiff);
        },
      },
      '🏓 Start Match vs Worker Bot',
    ),
  );

  // Section 2: Multiplayer PvP
  const westSlot = h(
    'div.tabletennis-slot',
    { class: opts.state.westPlayer ? 'taken' : '' },
    h('span.tabletennis-slot-label', {}, 'West Player'),
    h('span.tabletennis-slot-name', {}, opts.state.westPlayer ? opts.state.westPlayer.name : '(Open Slot)'),
    !opts.state.westPlayer
      ? h(
          'button.btn',
          {
            type: 'button',
            style: 'font-size:12px;font-weight:800;padding:4px 10px;',
            onclick: () => {
              modal.close();
              opts.onJoin('west', 'pvp');
            },
          },
          'Take West Side',
        )
      : false,
  );

  const eastSlot = h(
    'div.tabletennis-slot',
    { class: opts.state.eastPlayer ? 'taken' : '' },
    h('span.tabletennis-slot-label', {}, 'East Player'),
    h('span.tabletennis-slot-name', {}, opts.state.eastPlayer ? opts.state.eastPlayer.name : '(Open Slot)'),
    !opts.state.eastPlayer
      ? h(
          'button.btn',
          {
            type: 'button',
            style: 'font-size:12px;font-weight:800;padding:4px 10px;',
            onclick: () => {
              modal.close();
              opts.onJoin('east', 'pvp');
            },
          },
          'Take East Side',
        )
      : false,
  );

  const pvpCard = h(
    'div.tabletennis-card',
    {},
    h('div.tabletennis-card-title', {}, '👥 Multiplayer (2 Players)'),
    h('p.tabletennis-desc', {}, 'Real-time peer vs peer match on the balcony. First to 11 points (win by 2) wins!'),
    h('div.tabletennis-pvp-slots', {}, westSlot, eastSlot),
  );

  // Controls guide
  const controlsCard = h(
    'div.tabletennis-card',
    {},
    h('div.tabletennis-card-title', {}, '🎮 Controls Guide'),
    h(
      'div.tabletennis-controls-list',
      {},
      h('span.tabletennis-key', {}, 'Space / Click'),
      h('span', {}, 'Hold to build power; release to hit or serve'),
      h('span.tabletennis-key', {}, 'Mouse / Arrows'),
      h('span', {}, 'Aim across and short/deep; golden ring marks your target'),
      h('span.tabletennis-key', {}, 'A / D'),
      h('span', {}, 'Shift left / right along the table'),
      h('span.tabletennis-key', {}, 'W / S'),
      h('span', {}, 'Step closer or further from the table'),
      h('span.tabletennis-key', {}, 'E / Esc'),
      h('span', {}, 'Step back / leave match'),
    ),
  );

  const body = h('div.tabletennis-body', {}, scoreboard, botCard, pvpCard, controlsCard);
  modalEl.append(header, body);

  const modal = openModal(modalEl, {
    doing: 'playing table tennis',
    onClose: () => {
      activeModal = null;
    },
  });

  activeModal = modal;
  return modal;
}
