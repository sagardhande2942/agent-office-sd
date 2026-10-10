import type { PlacementView } from '../../../shared/protocol/object-placement';
import type { Slice } from '../store';
declare module '../store' {
  interface Store { placements: PlacementView }
  interface Topics { placements: true }
}
export const objectPlacement: Slice = {
  init(s) { s.placements = { map: 'office', items: {} }; },
  enter(s, m) { s.placements = m.placements ?? { map: 'office', items: {} }; return ['placements']; },
  on: {
    'placement.changed'(s, m) {
      if (m.floor !== s.floor || m.map !== s.placements.map) return;
      s.placements.items[m.id] = m.transform;
    },
    'placement.rejected'(s, m) {
      if (m.floor !== s.floor || m.map !== s.placements.map) return;
      s.placements.items[m.id] = m.transform;
    },
  },
};
