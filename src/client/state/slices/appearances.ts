import { defaultAppearanceState, type AppearanceState } from '../../../shared/appearances';
import type { Slice } from '../store';
declare module '../store' {
  interface Store { appearances: AppearanceState }
  interface Topics { appearances: true }
}
export const appearances: Slice = {
  init(s) { s.appearances = defaultAppearanceState(); },
  enter(s, m) { s.appearances = m.appearances ?? defaultAppearanceState(); return ['appearances']; },
  on: { appearance(s, m) { s.appearances = m.state; return ['appearances']; } },
};
