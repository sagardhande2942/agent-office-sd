import type { Ctx } from '../../core/context';
import { HUD_ACTIONS } from '../../ui/menu';
import { openFloorJoin } from './ui';

export function installFloorJoin(ctx: Ctx) {
  HUD_ACTIONS.push({ id: 'floor-join', icon: '🖥️', label: 'Connect your floor', section: 'Office', run: openFloorJoin });
}
