import type { LoreNote } from '../../../shared/protocol/lore';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Repository lore & shift handover notes on this floor. */
    lore: LoreNote[];
  }
  interface Topics {
    lore: true;
  }
}

export const lore: Slice = {
  init(s) {
    s.lore = [];
  },
  on: {
    'lore.all'(s, m) {
      s.lore = m.notes;
      return ['lore'];
    },
    'lore.saved'(s, m) {
      const idx = s.lore.findIndex((n) => n.id === m.note.id);
      if (idx >= 0) {
        s.lore = [...s.lore.slice(0, idx), m.note, ...s.lore.slice(idx + 1)];
      } else {
        s.lore = [m.note, ...s.lore];
      }
      return ['lore'];
    },
    'lore.deleted'(s, m) {
      s.lore = s.lore.filter((n) => n.id !== m.id);
      return ['lore'];
    },
  },
  enter(s, v) {
    s.lore = v.lore ?? [];
    return ['lore'];
  },
};
