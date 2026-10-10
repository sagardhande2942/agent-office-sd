// The screening room: the reels a floor has, and which one is on its screen and how far into it
// everyone is. Shared by the office (which keeps a reel per floor, see server/cinema.ts), the agent
// that records one (`office-workers cinema`, read in server/office-workers.ts), and the browser,
// which plays the shots for itself from the same point — the trick the jukebox and the TV use.
//
// A reel is a short run of pictures of the actual build, each with a caption saying what the behaviour
// shown is. See docs/cinema.md.

import { MEETING_ROOM } from './layout.js';

/** How a demonstration is meant to be: short, and captioned. */
export const REEL_TITLE_MAX = 80;
export const SHOT_CAPTION_MAX = 160;
/** A reel is a demonstration, not a video: this many shots at most. */
export const REEL_SHOTS_MAX = 12;
/** How long one shot is up before the next, in ms. */
export const SHOT_MS = 3200;
/** How many reels a floor keeps; the oldest go when a new one arrives. */
export const REELS_KEPT = 10;

/**
 * A shot's picture, decoded, before the office says no. Small on purpose: a shot is a screenshot of a
 * window, and a whole reel has to fit in one request body as base64 (see REEL_BODY_BYTES).
 */
export const SHOT_BYTES_MAX = 600_000;
/**
 * A shot's picture in *pixels*, which is the limit that actually matters: a PNG of one colour a few
 * kilobytes on disk can decode to gigabytes, and every browser on the floor would decode this one. A
 * screenshot of a window is nowhere near this.
 */
export const SHOT_PIXELS_MAX = 8_000_000;
/** How big one picture may be on each side, for the same reason. */
export const SHOT_SIDE_MAX = 4096;
/**
 * The whole reel as it arrives: every shot base64'd into one JSON body, plus room for the captions and
 * the base64's own overhead. The office reads a reel's request with exactly this limit, so what the
 * reel's own limits allow is what can actually be sent.
 */
export const REEL_BODY_BYTES = Math.ceil((SHOT_BYTES_MAX * REEL_SHOTS_MAX * 4) / 3) + 256 * 1024;

/** One shot of a reel: what the build looked like, and what that shows. */
export interface ReelShot {
  /** What the behaviour in this picture is, in a sentence. */
  caption: string;
  width: number;
  height: number;
}

/** A reel as the browser has it: every shot's caption, and no pictures (they are fetched one at a time). */
export interface ReelSummary {
  id: string;
  title: string;
  /** The pull request it demonstrates. */
  pr?: number;
  /** The worker that recorded it. */
  by?: string;
  /** When it was added, on the office's clock. */
  at: number;
  shots: ReelShot[];
}

/** A reel on the screening room's screen, and where everyone is in it. */
export interface CinemaState {
  reels: ReelSummary[];
  /** Whether a reel is meant to be on the screen, playing or paused. */
  on: boolean;
  /** Which reel, once one is on. */
  reel?: string;
  /** How many shots into it everyone is. */
  frame: number;
  playing: boolean;
  /** When `frame` and `playing` were last true, on the office's clock (see the 'pong' message). */
  at: number;
}

/** The screening room of a floor nobody has recorded anything for. */
export const CINEMA_OFF: CinemaState = { reels: [], on: false, frame: 0, playing: false, at: 0 };

/**
 * Where the screening room's screen hangs: on the meeting room's south wall, beside the board, facing
 * the table and the seats round it. That is the one room in the office people already sit down in to
 * look at something together, so a demonstration needs a room of its own making.
 *
 * It lives here rather than in shared/layout.ts because it is this feature's own furniture, and layout
 * is at its size budget.
 */
export const SCREEN = { x: 10.5, y: 1.72, z: MEETING_ROOM.maxZ - 0.09, width: 2.4, height: 1.35 } as const;

/** Which shot of `reel` everyone is meant to be looking at on the office's clock. */
export function frameAt(reel: ReelSummary, s: Pick<CinemaState, 'frame' | 'playing' | 'at'>, now: number): number {
  if (!reel.shots.length) return 0;
  const frame = Math.max(0, Math.floor(s.frame)) % reel.shots.length;
  if (!s.playing) return frame;
  const step = Math.floor(Math.max(0, now - s.at) / SHOT_MS);
  return step ? (frame + step) % reel.shots.length : frame;
}

/** How long a whole reel runs, in ms. */
export function reelMs(reel: ReelSummary): number {
  return reel.shots.length * SHOT_MS;
}

/** The reel on the screen in a state, if it is one that is still there. */
export function showing(s: CinemaState): ReelSummary | undefined {
  return s.on && s.reel ? s.reels.find((r) => r.id === s.reel) : undefined;
}

/** What the screening room says it is showing, for the hint bar and toasts. */
export function cinemaTitle(s: CinemaState): string {
  const reel = showing(s);
  return reel ? reel.title : 'nothing on';
}
