import type { CinemaState } from '../../../shared/cinema';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The screening room on your floor: its reels, and what its screen is showing. */
    cinema: CinemaState;
  }
  interface Topics {
    cinema: true;
  }
}

export const cinema: Slice = {
  init(s) {
    s.cinema = { reels: [], on: false, frame: 0, playing: false, at: 0 };
  },
  on: {
    cinema(s, m) {
      s.cinema = m.state;
      return ['cinema'];
    },
  },
  enter(s, v) {
    s.cinema = v.cinema;
    return ['cinema'];
  },
};
