import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { HUD_ACTIONS } from '../../ui/menu';
import { closeAllModals, toast, type Modal } from '../../ui/dom';
import type { ResearchView } from '../../../shared/trading-research';
import { openResearch } from './ui';
export function installTradingResearch(ctx: Ctx) {
  let modal: Modal | undefined, floor = store.floor;
  const listeners = new Set<(view: ResearchView) => void>();
  HUD_ACTIONS.push({ id: 'trading-research', icon: '📈', label: 'Trading Research', section: 'Office', run: () => {
    if (!store.floor) return toast('Take the elevator to a project floor first');
    closeAllModals(); modal = openResearch(ctx.net, fn => { listeners.add(fn); return () => listeners.delete(fn); });
  } });
  ctx.messages.on('research.state', msg => { if (msg.floor === store.floor) listeners.forEach(fn => fn(msg.view)); });
  store.on('floor', () => { if (floor !== store.floor) { floor = store.floor; modal?.close(); } });
}
