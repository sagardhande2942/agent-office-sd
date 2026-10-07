import type { Ctx } from '../../core/context';
import { isTopdownRoute } from '../topdown/camera';
import { openViewSelector, switchView } from '../../shared/view-selector';
import { HUD_ACTIONS } from '../../ui/menu';
export function installViewSelector(ctx: Ctx) {
  window.addEventListener('pagehide', () => ctx.net.disconnect());
  const topdown = isTopdownRoute();
  HUD_ACTIONS.push({ id: 'toggle-view', icon: '🔄', label: topdown ? 'Switch to 3D' : 'Switch to 2D', section: 'Office', status: () => true, chip: () => topdown ? '3D' : '2D', run: () => switchView(topdown ? '/' : '/2d', ctx.net) });
  HUD_ACTIONS.push({ id: 'views', icon: '🗺️', label: 'View: 3D / 2D Game / Lite', section: 'Office', status: () => true, chip: () => 'View', run: () => openViewSelector(ctx.net) });
}
