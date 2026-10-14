import type { Ctx } from '../../core/context';
import { HUD_ACTIONS } from '../../ui/menu';
import { PALETTE_ENTRIES } from '../palette';
import { store } from '../../state';
import { openActivityHeatmap } from '../../shared/activity-heatmap';
export function installActivityHeatmap(_ctx: Ctx) {
  const open = () => { if (store.floor) openActivityHeatmap(store.floor); };
  HUD_ACTIONS.push({ id: 'activity-heatmap', icon: '▦', label: 'Activity heatmap', section: 'Open', run: open });
  PALETTE_ENTRIES.push(() => [{ icon: '▦', kind: 'Action', title: 'Activity heatmap', keywords: ['time', 'phases', 'heatmap', 'activity'], open }]);
}
