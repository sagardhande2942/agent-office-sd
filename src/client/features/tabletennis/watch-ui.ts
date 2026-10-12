import { h } from '../../ui/dom';
import type { BotDifficulty, PingPongState } from '../../../shared/tabletennis';

export function watchBotsCard(state: PingPongState, start: (west: BotDifficulty, east: BotDifficulty) => void) {
  const difficulty = (name: string) => h('select', { 'aria-label': `${name} bot difficulty`, disabled: state.active && state.mode === 'bots' },
    ...(['easy', 'normal', 'pro'] as const).map(d => h('option', { value: d, selected: d === (name === 'West' ? state.westPlayer?.difficulty ?? 'normal' : state.eastPlayer?.difficulty ?? 'normal') }, d.toUpperCase())));
  const west = difficulty('West'), east = difficulty('East');
  return h('div.tabletennis-card', {}, h('div.tabletennis-card-title', {}, '🤖 Watch bots play'),
    h('p.tabletennis-desc', {}, 'Two bots serve, rally and score automatically. Completed matches restart after three seconds. The starter runs the exhibition; leaving stops it for everyone.'),
    h('label', {}, 'West ', west), h('label', {}, ' East ', east),
    h('button.tabletennis-play-btn', { type: 'button', disabled: state.active && state.mode !== 'bots', onclick: () => start(west.value as BotDifficulty, east.value as BotDifficulty) }, state.mode === 'bots' && state.active ? 'Watch current bot match' : 'Watch bots play'));
}
