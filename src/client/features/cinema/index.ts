import { frameAt, showing } from '../../../shared/cinema';
import { clip } from '../../ui/dom';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { ScreenPainter } from './screen';
import { Screening } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    cinema: true;
  }
}

export interface CinemaDeps {
  /** The floor whose reels these are, for the pictures of the build its screen shows. */
  floor(): string;
  /** Where a pull request is on the floor's forge, for a reel to link the one it demonstrates. */
  prUrl?(pr: number): string;
}

/**
 * The screening room in the meeting room: the reels its workers recorded against the build, each shot
 * captioned, and the screen on the wall showing whichever reel is on to everyone on the floor at once.
 *
 * Both the wall and the window work the shot out from the same four numbers and the office's clock (see
 * shared/cinema.ts), so nobody's copy of a reel runs ahead of anyone else's.
 */
export function installCinema(ctx: Ctx, deps: CinemaDeps) {
  const paint = new ScreenPainter(ctx.office.screening.screen, ctx.office.screening.caption);
  const window = new Screening(ctx.net, { floor: deps.floor, ...(deps.prUrl ? { prUrl: deps.prUrl } : {}) });
  /** Which shot of which reel the wall is painted with; '' for nothing on. */
  let shown = '';

  /** Puts the reel's shot on the wall, and tells the window which shot that is. */
  const paintScreen = () => {
    const state = store.cinema;
    const reel = showing(state);
    if (!reel) {
      window.frame(-1);
      if (shown) {
        shown = '';
        paint.idle(state.reels.length ? 'Press E at the screen' : 'Nothing on the screening room');
      }
      return;
    }
    const frame = frameAt(reel, state, store.officeNow());
    window.frame(frame);
    // Keyed by the reel as well as the shot: a new reel, or another one put on the screen, starts at
    // its first shot, and the wall must be repainted even when that is the shot already showing.
    const at = `${reel.id}:${frame}`;
    if (at === shown) return;
    shown = at;
    void paint.show(reel.id, frame, reel.shots[frame]?.caption ?? '', deps.floor());
  };

  // The room changing, and the shot moving on while a reel plays, are the two things to redraw for.
  store.on('cinema', () => {
    paint.forget(store.cinema.reels.map((r) => r.id));
    shown = '';
    window.refresh();
  });
  ctx.ticks.add('world', paintScreen);

  ctx.interactions.define('cinema', {
    reach: 4,
    hint: () => {
      const state = store.cinema;
      const reel = showing(state);
      const newest = state.reels[0];
      const what = reel ? `▶ ${clip(reel.title, 40)}` : newest ? `${state.reels.length} reel${state.reels.length === 1 ? '' : 's'}, nothing on` : 'no reels yet';
      return {
        k: `${reel?.id ?? ''}|${newest?.id ?? ''}|${state.reels.length}`,
        parts: [hintTitle('🎬 Screening room'), aside(what), key('E', state.reels.length ? 'Watch' : 'Open')],
      };
    },
    use: onE(() => window.open()),
  });
  return { window, paint };
}
