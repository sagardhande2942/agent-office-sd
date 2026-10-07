import type { Ctx } from '../../core/context';
import { isTopdownRoute } from '../topdown/camera';
import { openViewSelector, switchView } from '../../shared/view-selector';
import { HUD_ACTIONS } from '../../ui/menu';
export function installViewSelector(ctx: Ctx) {
  window.addEventListener('pagehide', () => ctx.net.disconnect());
  HUD_ACTIONS.push({ id: 'toggle-view', icon: '🔄', label: () => isTopdownRoute() ? 'Switch to 3D' : 'Switch to 2D', key: 'Y', section: 'Office', status: () => true, chip: () => isTopdownRoute() ? '3D' : '2D', run: () => switchView(isTopdownRoute() ? '/' : '/2d', ctx.net) });
  HUD_ACTIONS.push({ id: 'views', icon: '🗺️', label: 'View: 3D / 2D Game / Lite', section: 'Office', status: () => true, chip: () => 'View', run: () => openViewSelector(ctx.net) });
}
