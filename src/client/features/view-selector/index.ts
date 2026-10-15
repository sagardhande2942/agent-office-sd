import type { Ctx } from '../../core/context';
import { openViewSelector } from '../../shared/view-selector';
import { HUD_ACTIONS } from '../../ui/menu';
export function installViewSelector(ctx: Ctx) {
  window.addEventListener('pagehide', () => ctx.net.disconnect());
  HUD_ACTIONS.push({ id: 'views', icon: '🗺️', label: 'View', section: 'Office', run: () => openViewSelector(ctx.net) });
}
