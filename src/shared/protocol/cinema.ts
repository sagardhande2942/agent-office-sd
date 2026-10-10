import type { CinemaState } from '../cinema.js';

// The screening room on every floor: the reels its workers have recorded, and which one is on the
// screen. Unlike the toys, nothing here comes from a browser: the reels arrive from an agent that
// recorded them against the build (`office-workers cinema add`, see server/cinema.ts).

export type CinemaClientMsg =
  /** Put a reel on the screening room's screen, from its first shot or from `frame`. */
  | { t: 'cinema.play'; reel: string; frame?: number }
  /** Hold it where it is; play picks it up from there. */
  | { t: 'cinema.pause'; frame?: number }
  /** Off; the reels stay for next time. */
  | { t: 'cinema.stop' }
  /** Take a reel off the floor, with its pictures. */
  | { t: 'cinema.remove'; reel: string };

export type CinemaServerMsg = {
  /** What's in the screening room, and what the screen is showing. */
  t: 'cinema';
  state: CinemaState;
};
