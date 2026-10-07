import type { Ctx } from '../../core/context';
import { openViewSelector } from '../../shared/view-selector';
import { HUD_ACTIONS } from '../../ui/menu';
export function installViewSelector(ctx: Ctx) {
  window.addEventListener('pagehide', () => ctx.net.disconnect());
  HUD_ACTIONS.push({ id: 'views', icon: '🗺️', label: 'View: 3D / 2D Game / Lite', section: 'Office', status: () => true, chip: () => 'View', run: () => openViewSelector(ctx.net) });
}
