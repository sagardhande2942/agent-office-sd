// ---- YouTube's IFrame API, which is how play, pause and seek reach a YouTube link ----------------

export interface YoutubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /** 0–100, as YouTube counts it. */
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  getPlayerState(): number;
  destroy(): void;
}

export interface YoutubeApi {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YoutubePlayer;
}

export interface ListenerPosition {
  x: number;
  y: number;
  z: number;
}

/** Where your own hands cover the screen: alpha in each pixel of the viewport, rows from the bottom (as WebGL reads them). */
export interface HandCover {
  data: Uint8Array;
  width: number;
  height: number;
}

declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** YouTube's API, loaded the first time a link of its kind goes on; null when it can't be had. */
export let youtube: Promise<YoutubeApi | null> | null = null;
export function youtubeApi(): Promise<YoutubeApi | null> {
  if (youtube) return youtube;
  youtube = new Promise((resolve) => {
    const done = () => resolve(window.YT?.Player ? window.YT : null);
    if (window.YT?.Player) return done();
    const was = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      was?.();
      done();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = done;
    document.head.append(script);
    // Blocked or offline: fall back to a plain iframe rather than wait for a page that never comes.
    setTimeout(done, 10_000);
  });
  return youtube;
}
