import { ROOF } from '../../shared/rooftop';
import type { Game } from './context';
import type { Actions } from './actions';
import { $, h, toast, STATUS_LABEL } from '../ui/dom';
import { viewSelector } from '../shared/view-selector';
export function installHud(g: Game, actions: Actions) {
  $('views').append(viewSelector(g.net));
  for (const [id, label] of Object.entries({ issues: 'Issues', pulls: 'PRs', queue: 'Queue', manager: 'Manager', plans: 'Plan Comparison', new: 'New task' })) {
    const button = h('button.btn', { type: 'button', onclick: () => {
      if (!g.playable()) return toast('Select an Office floor and wait for connection', 'warn');
      actions.destinations[id as keyof typeof actions.destinations]();
      button.blur();
    } }, label);
    $('actions').append(button);
  }
  const floor = $('floor') as HTMLSelectElement;
  floor.addEventListener('change', () => {
    if (!g.net.up || !floor.value || floor.value === g.store.floor) return;
    g.transitioning = true; g.stop();
    g.net.send({ t: 'floor.go', floor: floor.value });
  });
  function refresh() {
    floor.replaceChildren(...g.store.floors.map(f => h('option', { value: f.id, disabled: !!f.cloning }, f.name)));
    floor.value = g.store.floor ?? '';
    $('notice').textContent = g.store.map.pick !== 'office' ? '2D Game supports Office only. Choose 3D or Lite for this map.' : (!g.store.floor || g.store.floor === ROOF) ? 'No Office floor selected. Add a project in 3D to play here.' : g.transitioning ? 'Changing floor…' : '';
  }
  for (const topic of ['floors', 'floor', 'map'] as const) g.store.on(topic, refresh);
  g.net.onStatus(up => { $('conn').classList.toggle('hidden', up); });
  // Readable roster also provides explicit actions when a desk is beyond the current map viewport.
  const roster = h('aside.game-roster', { 'aria-label': 'Workers' });
  $('game-stage').append(roster);
  function workers() {
    roster.replaceChildren(h('h2', {}, 'Workers'), ...[...g.store.workers.values()].map(w => h('section', {},
      h('button.worker-open', { type: 'button', onclick: () => actions.openWorker(w.id) }, `${w.name} · ${w.status === 'offline' ? 'offline' : STATUS_LABEL[w.status] ?? w.status}`),
      ...(['Prompt', 'Helper', 'Send home'] as const).map(label => h('button.btn', { type: 'button', onclick: () => {
        if (!g.playable()) return;
        if (label === 'Prompt') actions.promptAtDesk(w.deskId);
        if (label === 'Helper') actions.helperFor(w);
        if (label === 'Send home') actions.killWorker(w.id);
      } }, label)),
    )));
    roster.classList.toggle('hidden', !g.store.workers.size);
  }
  g.store.on('workers', workers); refresh(); workers();
}
