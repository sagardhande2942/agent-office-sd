import type { Ctx } from '../../core/context';
import type { CuratorState } from '../../../shared/lore-curator';
import type { LoreNote } from '../../../shared/protocol/lore';
import { store } from '../../state';
import { HUD_ACTIONS } from '../../ui/menu';
import { registerSettingsExtension } from '../../ui/settings-extensions';
import { h, toast, closeAllModals, type Modal } from '../../ui/dom';
import { openCurator } from './ui';
export function installLoreCurator(ctx: Ctx) {
  let state: CuratorState | undefined, floor = store.floor, modal: Modal | undefined;
  const listeners = new Set<(state: CuratorState) => void>();
  const historyListeners = new Set<(id: string, revisions: { revision: number; note: LoreNote }[]) => void>();
  const show = () => {
    if (!store.floor) return toast('Take the elevator to a floor first');
    closeAllModals();
    modal = openCurator({ net: ctx.net, state: () => state,
      listen(fn) { listeners.add(fn); return () => listeners.delete(fn); }, history(fn) { historyListeners.add(fn); return () => historyListeners.delete(fn); } });
  };
  HUD_ACTIONS.push({ id: 'lore-curator', icon: '🧠', label: 'Knowledge curator', section: 'Office', run: show });
  registerSettingsExtension({ pane: 'workers', create: () => ({ element: h('section.setting', {}, h('h3', {}, 'Knowledge curator'),
    h('p.setting-note', {}, 'Choose this floor’s automatic cleanup schedule, agent and model. Inspect runs and recover archived notes.'), h('button.btn', { type: 'button', onclick: show }, 'Configure curator')), dispose() {} }) });
  ctx.messages.on('curator.state', msg => { if (msg.floor === store.floor) { state = msg.state; listeners.forEach(fn => fn(state!)); } });
  ctx.messages.on('curator.history', msg => { if (msg.floor === store.floor) historyListeners.forEach(fn => fn(msg.id, msg.revisions)); });
  store.on('floor', () => { if (floor !== store.floor) { floor = store.floor; state = undefined; modal?.close(); } });
}
