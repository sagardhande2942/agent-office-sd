import { youtubeApi, type YoutubePlayer, type HandCover, type ListenerPosition } from './tv-youtube';
import { TvSiting, WIDTH, HEIGHT } from './tv-siting';
import { h } from './ui/dom';
import type { SceneCamera } from './features/topdown/camera';
import type { Collider } from './world/office';
export { homography, blocks } from './tv-projection';
export { WIDTH, HEIGHT } from './tv-siting';
export { MASK_W, MASK_H } from './tv-mask';
// The big TV's picture: an ordinary `<iframe>` or `<video>` laid over the canvas and re-projected
// onto the TV's rectangle every frame, because WebGL can't draw a cross-origin player (see
// docs/tv-streaming.md). What's on it is shared state like the jukebox's; this keeps whatever is
// playing here in step with it, and takes the picture away whenever the TV can't be seen.
//
// This file is the link and the player: what it is, what it should be doing, and how loud it is.
// Where the picture goes on screen — the projection, the occlusion mask and the layer over the
// canvas — is tv-siting.ts, and the mask's arithmetic is tv-mask.ts, which has no DOM in it so it can
// be measured and tested without a browser.

import type * as THREE from 'three';
import { TV } from '../shared/layout';
import { TV_OFF, classify, embedUrl, positionAt, youtubeId, type TvKind, type TvState } from '../shared/tv';
import { roomMediaGain } from './spatial-audio';
import { store } from './state';
import { toast } from './ui/dom';

/** Seconds out of step with the floor before the picture is dragged back to where it should be. */
export const CATCH_UP = 1.5;
/** How often that's checked (ms). */
export const TICK = 500;

/** The two things that can be playing, as far as the sound knob is concerned (see applySound). */
type MediaPlayer = HTMLVideoElement | YoutubePlayer;

/** The link on the TV, as it plays here: the element itself, and where it is against everyone else's. */
export class TvScreen {
  /** Where it goes on screen, and what stands in front of it (see tv-siting.ts). */
  private readonly siting: TvSiting;
  private state: TvState = TV_OFF;
  /** How the picture is being driven, which is embed rather than youtube when the API can't load. */
  private kind: TvKind | null = null;
  private el: HTMLElement | null = null;
  private yt: YoutubePlayer | null = null;
  /**
   * Whether YouTube's player has said it's ready. `new YT.Player(…)` hands back an object whose
   * methods only arrive with `onReady`; asking it anything before then throws, and one throw in the
   * frame loop used to leave the whole office frozen.
   */
  private ready = false;
  /** What the element was loaded with, and where from (for an embed, which can't be asked). */
  private link = '';
  private from = 0;
  private started = 0;
  private ran = false;
  private checked = 0;
  /** When the browser last refused to start it with sound (see blocked). */
  private refusedAt = 0;
  /** How loud your own speakers are, 0–1, and whether they're off. Just yours, like the jukebox's. */
  volume = 1;
  muted = false;
  private soundDistance = Infinity;
  /** False on the roof and on maps of their own, where the office's jukebox is silent too. */
  private soundHere = false;
  /** Told when the sound changes here rather than in the window (the autoplay fallback does it). */
  onSound: (() => void) | null = null;
  /** What the player was last told: which one, how loud, and whether it was muted (see applySound). */
  private player: MediaPlayer | null = null;
  private sounding = -1;
  private silenced = true;

  constructor(screen: THREE.Mesh) {
    this.siting = new TvSiting(screen);
  }

  /** The 1280×720 element whatever plays goes in; the picture on the wall is tv-siting.ts's. */
  get frame(): HTMLElement {
    return this.siting.frame;
  }

  /** Where your own hands cover the screen, for the picture to hide behind (see TvSiting.handCover). */
  get handCover(): (() => HandCover | null) | null {
    return this.siting.handCover;
  }
  set handCover(cover: (() => HandCover | null) | null) {
    this.siting.handCover = cover;
  }

  /** The floor says the TV changed: take it down, put what's on it up, or bring it back in step. */
  sync(state: TvState) {
    this.state = state;
    if (!state.on || !state.url || state.url !== this.link) this.load();
    else this.align(store.officeNow(), true);
  }

  /** How long the video is here, when the player will say (an arbitrary embed never will): 0 for none. */
  duration(): number {
    try {
      if (this.kind === 'media' && this.el instanceof HTMLVideoElement) return Number.isFinite(this.el.duration) ? this.el.duration : 0;
      if (this.kind === 'youtube' && this.yt && this.ready) return this.yt.getDuration() || 0;
    } catch {
      // not far enough into the video to know yet
    }
    return 0;
  }

  /**
   * How drunk you are, so the picture on the TV goes with the rest of the office: it wobbles,
   * doubles and smears too, on the same clock as the world (see drunkframe.ts, the same effect
   * world/drunk.ts puts on the canvas).
   */
  setDrunk(amount: number, time: number, motion: boolean) {
    this.siting.setDrunk(amount, time, motion);
  }

  /** Your own speakers: how loud, and whether they're off. False when this player won't take it. */
  setVolume(volume: number, muted: boolean): boolean {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    return this.applySound();
  }

  /** Updates the listener used to make the TV quieter with distance, like the jukebox. */
  setListener(position: ListenerPosition, here = true) {
    const distance = Math.hypot(position.x - TV.x, position.y - TV.y, position.z - TV.z);
    if (here === this.soundHere && Math.abs(distance - this.soundDistance) < 0.02) return;
    this.soundDistance = distance;
    this.soundHere = here;
    this.applySound(false);
  }

  /** Turns your own speakers down or up. False when this player won't take the order (see the window). */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.applySound()) return true;
    this.muted = !this.muted;
    return false;
  }

  /**
   * Puts the level and the mute on whatever is playing here, so the window, the settings and the
   * autoplay fallback all come out the same. Not every player takes orders: an arbitrary embed has
   * no sound knob at all, and says so (see the window).
   *
   * The level is worked out to the whole percent YouTube counts in, and a player is only told about
   * it when that percent or the mute has actually changed. This is asked for every frame while you
   * walk — your distance from the TV moves by centimetres a frame, and so does your own slider —
   * and YouTube's API takes each order as a message across the frame into the player, so telling it
   * the same thing sixty times a second is sixty messages a second for nothing.
   */
  private applySound(notify = true): boolean {
    const media = this.kind === 'media' && this.el instanceof HTMLVideoElement ? this.el : null;
    const youtube = this.kind === 'youtube' && this.yt && this.ready ? this.yt : null;
    if (!media && !youtube) return false;
    const off = this.muted || this.volume === 0;
    const level = Math.round(roomMediaGain(this.volume, this.soundDistance, this.soundHere) * 100);
    const player = media ?? youtube;
    if (this.player !== player || this.sounding !== level || this.silenced !== off) {
      this.player = player;
      this.sounding = level;
      this.silenced = off;
      if (media) {
        media.volume = level / 100;
        media.muted = off;
      } else if (youtube) {
        youtube.setVolume(level);
        if (off) youtube.mute();
        else youtube.unMute();
      }
      if (notify) this.onSound?.();
    }
    return true;
  }

  /**
   * Every frame: keep the picture where the floor says it should be, then put it on the TV's
   * rectangle — or take it away, if the TV isn't somewhere you can see it (call after rendering).
   */
  update(camera: SceneCamera, show: boolean, colliders: readonly Collider[], listener: ListenerPosition, soundHere = show) {
    this.setListener(listener, soundHere);
    try {
      this.align(store.officeNow());
    } catch {
      // A player that won't answer is no reason to take the frame down; the next tick tries again.
    }
    this.siting.update(camera, show, colliders, this.state.on && !!this.el);
  }

  // ---- What's on it ---------------------------------------------------------------------------

  private load() {
    this.clear();
    const s = this.state;
    if (!this.siting.layer || !s.on || !s.url) return;
    this.link = s.url;
    this.kind = classify(s.url);
    this.from = positionAt(s, store.officeNow());
    this.started = Date.now();
    this.ran = s.playing;
    if (this.kind === 'youtube') void this.loadYoutube(s.url, this.from, s.playing);
    else if (this.kind === 'media') this.loadMedia(s.url, this.from, s.playing);
    else this.loadEmbed(s.url, this.from, s.playing);
  }

  private clear() {
    this.yt?.destroy();
    this.yt = null;
    this.ready = false;
    this.el?.remove();
    this.el = null;
    this.kind = null;
    this.link = '';
    this.from = 0;
    this.started = 0;
    this.ran = false;
    // What comes next is a different player, and a new link has said nothing about what stands in
    // front of it: both are told afresh, and the mask comes off (see siting.forget).
    this.player = null;
    this.siting.forget();
  }

  /** A direct media file: the only player that can be asked anything at all, and asked at once. */
  private loadMedia(url: string, start: number, playing: boolean) {
    const video = h('video', { src: url, autoplay: '', playsinline: '', preload: 'auto' }) as HTMLVideoElement;
    this.el = video;
    this.frame.append(video);
    this.applySound(false);
    const begin = () => {
      if (start > 1 && Math.abs(video.currentTime - start) > 1) {
        try {
          video.currentTime = start;
        } catch {
          // no metadata yet: the first tick will try again
        }
      }
      if (playing) this.roll(video);
    };
    if (video.readyState > 0) begin();
    else video.addEventListener('loadedmetadata', begin, { once: true });
  }

  /** Anything else in an iframe: it plays or it doesn't, at the site's discretion. */
  private loadEmbed(url: string, start: number, playing: boolean) {
    let src = embedUrl(url, start);
    if (!playing) {
      // Loaded while it's paused (you joined half way through): don't start it going.
      try {
        const u = new URL(src);
        u.searchParams.delete('autoplay');
        src = u.href;
      } catch {
        // a link that can't be re-read is played as it came
      }
    }
    const frame = h('iframe', { src, title: 'Office TV', allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: '' }) as HTMLIFrameElement;
    this.el = frame;
    this.frame.append(frame);
  }

  private async loadYoutube(url: string, start: number, playing: boolean) {
    const link = this.link;
    const wrap = h('div.tv-player');
    const host = h('div');
    wrap.append(host);
    this.el = wrap;
    this.frame.append(wrap);
    const id = youtubeId(url);
    const api = await youtubeApi();
    // Something else went on (or came off) while the API was fetched.
    if (this.link !== link || this.el !== wrap) return;
    if (!api || !id) {
      // No API: a plain iframe, which starts where it's told and then runs as it likes.
      wrap.remove();
      this.kind = 'embed';
      this.loadEmbed(url, start, playing);
      return;
    }
    const player = new api.Player(host, {
      width: WIDTH,
      height: HEIGHT,
      videoId: id,
      playerVars: { autoplay: playing ? 1 : 0, start: Math.floor(start), playsinline: 1, rel: 0, controls: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          // Only if this is still the player on the TV (a new link may have arrived meanwhile).
          if (this.yt !== player) return;
          this.ready = true;
          this.applySound(false);
          if (start > 1 && Math.abs(player.getCurrentTime() - start) > 1) player.seekTo(start, true);
          if (playing) player.playVideo();
          else player.pauseVideo();
        },
        onAutoplayBlocked: () => this.blocked(player),
      },
    });
    if (this.link !== link) {
      // Synced on again to something else while it was being built.
      player.destroy();
      return;
    }
    this.yt = player;
  }

  /** The browser won't start it with sound: turn the sound down, try again, and say so. */
  private blocked(player: YoutubePlayer) {
    const now = Date.now();
    if (now - this.refusedAt < 4000) return;
    this.refusedAt = now;
    if (!this.muted) {
      this.muted = true;
      this.onSound?.();
      toast('The browser held the TV’s sound back — the sound row in the TV window turns it on', 'warn');
    }
    try {
      player.mute();
      player.playVideo();
    } catch {
      // a player that won't take the order yet: the next tick tries again
    }
  }

  /** Started (or started again) with sound the browser may not allow yet: quietly is better than never. */
  private roll(video: HTMLVideoElement) {
    void video.play().catch(() => {
      if (this.muted) return;
      this.muted = true;
      video.muted = true;
      this.onSound?.();
      toast('The browser held the TV’s sound back — the sound row in the TV window turns it on', 'warn');
      void video.play().catch(() => {});
    });
  }

  // ---- Keeping in step ------------------------------------------------------------------------

  /** Puts this browser back where the floor says the TV is: playing, paused, and at the right second. */
  private align(now: number, force = false) {
    if (!force && now - this.checked < TICK) return;
    this.checked = now;
    const s = this.state;
    if (!s.on || !this.el || !this.kind) return;
    const want = positionAt(s, now);
    if (this.kind === 'media' && this.el instanceof HTMLVideoElement) {
      const video = this.el;
      const end = video.duration;
      const away = Number.isFinite(end) && want >= end - 0.2;
      if (Math.abs(want - video.currentTime) > CATCH_UP && !away) {
        try {
          video.currentTime = want;
        } catch {
          // no metadata yet; next tick
        }
      }
      if (s.playing && !away && video.paused) this.roll(video);
      else if (!s.playing && !video.paused) video.pause();
      return;
    }
    if (this.kind === 'youtube') {
      // Its methods only arrive with `onReady`; until then there is nothing to ask (see ready).
      if (!this.yt || !this.ready) return;
      const yt = this.yt;
      const end = yt.getDuration();
      const away = end > 0 && want >= end - 0.2;
      const state = yt.getPlayerState();
      if (Math.abs(want - yt.getCurrentTime()) > CATCH_UP && !away) yt.seekTo(want, true);
      // Not straight after a refusal: that only makes it refuse again (see blocked).
      const stubborn = Date.now() - this.refusedAt < 4000;
      if (s.playing && !away && !stubborn && state !== 1 && state !== 3) yt.playVideo();
      else if (!s.playing && (state === 1 || state === 3)) yt.pauseVideo();
      return;
    }
    // An embed can't be asked, so it's reloaded when the floor moves it on or back.
    const have = this.from + (this.ran ? (Date.now() - this.started) / 1000 : 0);
    if (s.playing !== this.ran || Math.abs(want - have) > CATCH_UP) this.load();
  }
}
