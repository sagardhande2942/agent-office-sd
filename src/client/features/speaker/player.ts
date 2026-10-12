/**
 * The smart speaker's music: ONE HTML5 Audio element for the whole browser session, so a second track
 * can never play over the first. The player window (ui.ts) drives it, and the speaker's own lights
 * (index.ts) read whether it's playing.
 *
 * A pasted link is played as plain media, not through Web Audio: most hosts don't send the CORS
 * headers a MediaElementSource would need, and a source it can't read plays silently. The element's
 * own `volume` is therefore how the music follows how far you stand from the speaker (the same curve
 * the jukebox's panner uses — see spatial-audio.ts), and how you set it yourself.
 */
import { roomMediaGain } from '../../spatial-audio';
import { checkAudioUrl, trackName } from './url';

export type SpeakerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';

/** The part of an HTMLAudioElement this uses, so a test can hand it one that isn't a browser's. */
export interface AudioLike {
  src: string;
  preload: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly error: { readonly code: number } | null;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/** What the window draws: the track, where it is, and how the sound is set. */
export interface SpeakerState {
  status: SpeakerStatus;
  /** The link playing now, or '' with nothing loaded. */
  url: string;
  /** What the track is called, from its link. */
  title: string;
  currentTime: number;
  /** Seconds long, or 0 while it isn't known yet. */
  duration: number;
  /** Your own volume, 0–1. */
  volume: number;
  muted: boolean;
  /** What went wrong, for the window to show. Empty when nothing has. */
  error: string;
  /** How loud the speaker is where you stand, 0–1, the distance part alone. */
  roomGain: number;
  /** Whether there's a track before/after this one in the links loaded this session. */
  canPrev: boolean;
  canNext: boolean;
}

/** What a playback failure means, in words: an aborted load, a dropped network, a bad file, a page. */
export function audioErrorMessage(error: { readonly code?: number } | null): string {
  switch (error?.code) {
    case 1:
      return 'The audio load was aborted.';
    case 2:
      return 'The network dropped while loading that link.';
    case 3:
      return 'That file is damaged, or this browser can’t decode its format.';
    case 4:
      return 'That link isn’t a playable audio file: it may be a web page, or the site blocks playing it here.';
    default:
      return 'That audio couldn’t be played. Is the link a direct audio file?';
  }
}

/** Why `play()` refused, in words. */
export function playErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : '';
  if (name === 'NotSupportedError') return 'That link isn’t an audio file this browser can play.';
  if (name === 'NotAllowedError') return 'Your browser blocked playback — press ▶️ Play.';
  return 'That audio wouldn’t play here. Is the link a direct audio file?';
}

/** Seconds as `12:34`, or `1:02:03` past the hour. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const LABELS: Record<SpeakerStatus, string> = { idle: 'nothing loaded', loading: 'loading…', playing: 'playing', paused: 'paused', stopped: 'stopped', error: 'error' };

/** What the player says it's doing, for the window's meta line. */
export function statusLabel(status: SpeakerStatus): string {
  return LABELS[status];
}

export class SpeakerPlayer {
  /** The one element, made the first time something is loaded. */
  private el: AudioLike | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly offs: (() => void)[] = [];
  /** The links loaded this session, oldest first, and where in them we are: what ⏮️ / ⏭️ walk. */
  private readonly links: string[] = [];
  private index = -1;
  private status: SpeakerStatus = 'idle';
  private error = '';
  private volume = 0.8;
  private muted = false;
  /** How far you stand from the speaker, and whether it's on a floor you can hear it on. */
  private distance = 0;
  private audible = true;
  /** Bumped whenever playback is replaced or stopped, so a stale `play()` refusal is ignored. */
  private generation = 0;

  /** `createAudio` makes the element (a browser's Audio by default); a test hands in a fake. */
  constructor(private readonly createAudio: () => AudioLike = () => new Audio()) {}

  /** Everything the window draws, read fresh. */
  state(): SpeakerState {
    const el = this.el;
    const duration = el && Number.isFinite(el.duration) ? el.duration : 0;
    return {
      status: this.status,
      url: el?.src ?? '',
      title: this.title(),
      currentTime: el ? Math.max(0, Math.min(el.currentTime, duration || el.currentTime)) : 0,
      duration,
      volume: this.volume,
      muted: this.muted,
      error: this.error,
      roomGain: roomMediaGain(1, this.distance, this.audible),
      canPrev: this.index > 0,
      canNext: this.index >= 0 && this.index < this.links.length - 1,
    };
  }

  /** Hears when anything changes; returns how to stop hearing it. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** The one audio element, once something has been loaded (for diagnostics and tests). */
  audio(): AudioLike | null {
    return this.el;
  }

  playing(): boolean {
    return this.status === 'playing';
  }

  /** Loads `raw` and starts it. A link that isn't one at all comes back as `{error}`. */
  load(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
    const found = checkAudioUrl(raw);
    if ('error' in found) {
      this.error = found.error;
      this.changed();
      return { ok: false, error: found.error };
    }
    const el = this.element();
    this.replace(el);
    const at = this.links.indexOf(found.url);
    if (at >= 0) this.index = at;
    else {
      this.links.push(found.url);
      this.index = this.links.length - 1;
    }
    this.error = '';
    this.status = 'loading';
    el.src = found.url;
    el.load();
    this.changed();
    this.start(this.generation);
    return { ok: true, url: found.url };
  }

  /** Carries on, or starts what's loaded. Pressing it with nothing loaded says so in the window. */
  play(): void {
    this.start(this.generation);
  }

  private start(generation: number): void {
    const el = this.element();
    if (!el.src) {
      this.error = 'Load a track first: paste a direct audio link and press 📥 Load Music.';
      this.status = 'idle';
      this.changed();
      return;
    }
    this.error = '';
    const started = () => {
      if (generation !== this.generation) return;
      this.status = 'playing';
      this.changed();
    };
    try {
      const p = el.play();
      if (p && typeof p.then === 'function') p.then(started, (e: unknown) => this.refused(e, generation));
      else started();
    } catch (e) {
      this.refused(e, generation);
    }
  }

  private refused(error: unknown, generation: number): void {
    if (generation !== this.generation) return;
    const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : '';
    if (name === 'NotAllowedError') {
      this.status = 'paused';
      this.error = playErrorMessage(error);
    } else if (name === 'AbortError') {
      // Something newer took playback over: not a failure of its own.
      return;
    } else {
      // The element's own MediaError says more than a refused promise (a dropped network, a format
      // this browser can't decode, a page rather than a file), so it wins when there is one.
      this.error = this.el?.error ? audioErrorMessage(this.el.error) : playErrorMessage(error);
      this.status = 'error';
    }
    this.changed();
  }

  pause(): void {
    const el = this.el;
    if (!el) return;
    el.pause();
    if (this.status === 'playing' || this.status === 'loading') this.status = 'paused';
    this.changed();
  }

  /** Stops it and goes back to the start, ready for the next Play. */
  stop(): void {
    const el = this.el;
    if (!el) return;
    this.generation++;
    el.pause();
    el.currentTime = 0;
    this.status = el.src ? 'stopped' : 'idle';
    this.error = '';
    this.changed();
  }

  /** Back to the top: carrying on from there if it was paused. */
  restart(): void {
    const el = this.el;
    if (!el || !el.src) return this.play();
    el.currentTime = 0;
    if (this.status === 'playing') this.changed();
    else this.start(this.generation);
  }

  /** Jumps to `seconds`, kept inside the track. */
  seek(seconds: number): void {
    const el = this.el;
    if (!el) return;
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Math.max(0, seconds);
    el.currentTime = Math.max(0, Math.min(seconds, max));
    this.changed();
  }

  /** The link before this one, if one was loaded. */
  prev(): void {
    this.goTo(this.index - 1);
  }

  /** The link after this one, if one was loaded. */
  next(): void {
    this.goTo(this.index + 1);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
    this.applyVolume();
    this.changed();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
    this.changed();
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /**
   * How far you stand from the speaker (`distance` in meters), and whether it's on a floor you can
   * hear it on at all: the music fades with distance, and goes silent off the floor (see index.ts).
   */
  setRoom(distance: number, audible: boolean): void {
    this.distance = Number.isFinite(distance) ? distance : 0;
    this.audible = audible;
    this.applyVolume();
  }

  /** Lets go of the element: its listeners come off and it can't play any more. */
  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.el) {
      try {
        this.el.pause();
      } catch {
        // an element already torn down
      }
    }
    this.el = null;
    this.listeners.clear();
  }

  // ---- Inside ----------------------------------------------------------------------------------

  private title(): string {
    const url = this.el?.src ?? '';
    return url ? trackName(url) : '';
  }

  private goTo(index: number): void {
    if (index < 0 || index >= this.links.length || index === this.index) return;
    this.index = index;
    this.load(this.links[index]);
  }

  /** The one element, made and wired the first time it's wanted: never a second one. */
  private element(): AudioLike {
    if (!this.el) {
      this.el = this.createAudio();
      this.wire(this.el);
    }
    return this.el;
  }

  /** Stops whatever is on and forgets it, before a new link is put in. */
  private replace(el: AudioLike): void {
    this.generation++;
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.currentTime = 0;
  }

  private wire(el: AudioLike): void {
    const on = (type: string, fn: () => void) => {
      el.addEventListener(type, fn);
      this.offs.push(() => el.removeEventListener(type, fn));
    };
    on('loadedmetadata', () => this.changed());
    on('durationchange', () => this.changed());
    on('timeupdate', () => this.changed());
    on('play', () => {
      this.error = '';
      this.status = 'playing';
      this.changed();
    });
    on('playing', () => {
      this.error = '';
      this.status = 'playing';
      this.changed();
    });
    on('pause', () => {
      if (this.status === 'playing') {
        this.status = 'paused';
        this.changed();
      }
    });
    on('ended', () => {
      this.status = 'stopped';
      this.changed();
    });
    on('error', () => {
      this.error = audioErrorMessage(el.error);
      this.status = 'error';
      this.changed();
    });
  }

  private applyVolume(): void {
    const el = this.el;
    if (!el) return;
    el.muted = this.muted;
    el.volume = roomMediaGain(this.volume, this.distance, this.audible);
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
