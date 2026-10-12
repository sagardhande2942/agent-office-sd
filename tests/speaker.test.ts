import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM_AUDIO_REF, roomDistanceGain } from '../src/client/spatial-audio.js';
import { audioErrorMessage, clock, playErrorMessage, SpeakerPlayer, statusLabel, type AudioLike } from '../src/client/features/speaker/player.js';
import { audioLinkNote, checkAudioUrl, isDirectAudioLink, trackName } from '../src/client/features/speaker/url.js';

/** A stand-in for the HTMLAudioElement the player drives, so this runs under node. */
class FakeAudio implements AudioLike {
  src = '';
  preload = 'auto';
  volume = 1;
  muted = false;
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  error: { code: number } | null = null;
  /** What `play()` should reject with instead of starting. */
  refuse: unknown = null;
  plays = 0;
  loads = 0;
  removed: string[] = [];
  private readonly hearing = new Map<string, Set<() => void>>();

  play(): Promise<void> {
    this.plays++;
    if (this.refuse) return Promise.reject(this.refuse);
    this.paused = false;
    this.fire('play');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.fire('pause');
  }

  load(): void {
    this.loads++;
  }

  removeAttribute(name: string): void {
    this.removed.push(name);
    if (name === 'src') this.src = '';
  }

  addEventListener(type: string, fn: () => void): void {
    let set = this.hearing.get(type);
    if (!set) this.hearing.set(type, (set = new Set()));
    set.add(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.hearing.get(type)?.delete(fn);
  }

  /** Pretends the browser fired `type`. */
  fire(type: string): void {
    for (const fn of [...(this.hearing.get(type) ?? [])]) fn();
  }

  get listeners(): number {
    let n = 0;
    for (const set of this.hearing.values()) n += set.size;
    return n;
  }
}

/** A player with its one element made, so tests can poke it. */
function withPlayer() {
  const audio = new FakeAudio();
  let made = 0;
  const player = new SpeakerPlayer(() => {
    made++;
    return audio;
  });
  return { audio, player, made: () => made };
}

test('a link is checked before anything tries to play it', () => {
  assert.match((checkAudioUrl('') as { error: string }).error, /Paste a direct link/);
  assert.match((checkAudioUrl('not a link') as { error: string }).error, /isn't a web address/);
  assert.match((checkAudioUrl('ftp://files.example.com/a.mp3') as { error: string }).error, /Only http and https/);
  assert.ok((checkAudioUrl(`https://cdn.example.com/${'a'.repeat(2100)}.mp3`) as { error: string }).error);
  const ok = checkAudioUrl('https://cdn.example.com/music/song.mp3?token=1');
  assert.deepEqual(ok, { url: 'https://cdn.example.com/music/song.mp3?token=1' });
  // A URL object's own normalization is what comes back.
  assert.equal((checkAudioUrl('  https://cdn.example.com/a.mp3  ') as { url: string }).url, 'https://cdn.example.com/a.mp3');
});

test('a page link is warned about, not refused, and a direct file is not', () => {
  assert.match(audioLinkNote('https://www.youtube.com/watch?v=dQw4w9WgXcQ') ?? '', /YouTube page/);
  assert.match(audioLinkNote('https://open.spotify.com/track/123') ?? '', /Spotify page/);
  assert.match(audioLinkNote('https://cdn.example.com/stream') ?? '', /No audio file in that link/);
  assert.equal(audioLinkNote('https://cdn.example.com/song.mp3'), null);
  assert.equal(audioLinkNote('https://cdn.example.com/song.MP3'), null);
  assert.equal(audioLinkNote('https://cdn.example.com/live/radio.ogg?x=1'), null);
  assert.equal(isDirectAudioLink('https://cdn.example.com/song.wav'), true);
  assert.equal(isDirectAudioLink('https://cdn.example.com/song'), false);
  assert.equal(isDirectAudioLink('nonsense'), false);
});

test('a track is named after its file, and falls back to its site', () => {
  assert.equal(trackName('https://cdn.example.com/music/My%20Song.mp3?v=2'), 'My Song');
  assert.equal(trackName('https://cdn.example.com/a/cool_track-2.ogg'), 'cool track-2');
  assert.equal(trackName('https://example.com/'), 'example.com');
  assert.equal(trackName('https://www.example.com/'), 'example.com');
  assert.equal(trackName('not a link'), 'not a link');
});

test('playing times say what they are', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3661), '1:01:01');
  assert.equal(clock(Number.NaN), '0:00');
  assert.equal(statusLabel('playing'), 'playing');
  assert.match(audioErrorMessage({ code: 4 }), /isn’t a playable audio file/);
  assert.match(audioErrorMessage({ code: 2 }), /network dropped/);
  assert.match(audioErrorMessage(null), /couldn’t be played/);
  assert.match(playErrorMessage({ name: 'NotSupportedError' }), /isn’t an audio file/);
  assert.match(playErrorMessage({ name: 'NotAllowedError' }), /blocked playback/);
  assert.match(playErrorMessage(new Error('boom')), /wouldn’t play/);
});

test('one audio element plays one track at a time', async () => {
  const { audio, player, made } = withPlayer();
  const first = player.load('https://cdn.example.com/one.mp3');
  assert.deepEqual(first, { ok: true, url: 'https://cdn.example.com/one.mp3' });
  await Promise.resolve();
  assert.equal(made(), 1, 'one element for the session');
  assert.equal(player.audio(), audio);
  assert.equal(audio.src, 'https://cdn.example.com/one.mp3');
  assert.equal(player.playing(), true);
  assert.equal(player.state().title, 'one');
  // A second link replaces the first in the same element, never beside it.
  player.load('https://cdn.example.com/two.mp3');
  assert.equal(made(), 1);
  assert.equal(audio.removed.includes('src'), true, 'the first link was let go of');
  assert.equal(audio.src, 'https://cdn.example.com/two.mp3');
});

test('load, play, pause, stop and restart are what they say', async () => {
  const { audio, player } = withPlayer();
  const bad = player.load('');
  assert.deepEqual(bad, { ok: false, error: 'Paste a direct link to an audio file first' });
  assert.equal(audio.plays, 0, 'nothing is played for a link that was never loaded');

  player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  assert.equal(player.state().status, 'playing');
  player.pause();
  assert.equal(player.state().status, 'paused');
  assert.equal(audio.paused, true);

  audio.currentTime = 12;
  player.stop();
  assert.equal(player.state().status, 'stopped');
  assert.equal(audio.currentTime, 0, 'stop goes back to the start');
  assert.equal(audio.paused, true);

  player.play();
  await Promise.resolve();
  assert.equal(player.playing(), true, 'play carries on from the top after a stop');

  audio.currentTime = 30;
  player.restart();
  assert.equal(audio.currentTime, 0);
  assert.equal(player.playing(), true);
});

test('seeking stays inside the track, and the player reports where it is', async () => {
  const { audio, player } = withPlayer();
  player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  audio.duration = 100;
  audio.currentTime = 40;
  audio.fire('timeupdate');
  const state = player.state();
  assert.equal(state.duration, 100);
  assert.equal(state.currentTime, 40);
  player.seek(250);
  assert.equal(audio.currentTime, 100);
  player.seek(-5);
  assert.equal(audio.currentTime, 0);
});

test('volume, mute and how far away you stand all reach the element', async () => {
  const { audio, player } = withPlayer();
  player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  player.setVolume(1);
  player.setRoom(ROOM_AUDIO_REF, true);
  assert.equal(audio.volume, 1, 'full in the near field');
  player.setRoom(12, true);
  assert.ok(Math.abs(audio.volume - roomDistanceGain(12)) < 1e-9, 'the same curve the jukebox fades by');
  player.setRoom(12, false);
  assert.equal(audio.volume, 0, 'silent on another floor');
  player.setRoom(ROOM_AUDIO_REF, true);
  player.setVolume(0.5);
  assert.ok(Math.abs(audio.volume - 0.25) < 1e-9, 'your own slider is squared, like the jukebox’s');
  assert.equal(player.state().roomGain, 1);
  player.toggleMute();
  assert.equal(audio.muted, true);
  assert.equal(player.state().muted, true);
  player.setMuted(false);
  assert.equal(audio.muted, false);
});

test('the links loaded this session are what previous and next walk', async () => {
  const { player } = withPlayer();
  player.load('https://cdn.example.com/one.mp3');
  assert.equal(player.state().canPrev, false);
  assert.equal(player.state().canNext, false);
  player.load('https://cdn.example.com/two.mp3');
  assert.equal(player.state().canPrev, true);
  player.load('https://cdn.example.com/three.mp3');
  await Promise.resolve();
  assert.equal(player.state().canNext, false);
  player.prev();
  assert.equal(player.state().title, 'two');
  player.prev();
  assert.equal(player.state().title, 'one');
  assert.equal(player.state().canPrev, false);
  player.next();
  assert.equal(player.state().title, 'two');
  // Loading a link already in the list moves to it rather than adding it twice.
  player.load('https://cdn.example.com/one.mp3');
  assert.equal(player.state().title, 'one');
  assert.equal(player.state().canNext, true);
  assert.equal(player.state().canPrev, false);
});

test('a file that will not play says why, and a blocked autoplay is not an error with the link', async () => {
  const { audio, player } = withPlayer();
  player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  audio.error = { code: 3 };
  audio.fire('error');
  assert.equal(player.state().status, 'error');
  assert.match(player.state().error, /damaged/);

  const other = withPlayer();
  other.player.load('https://cdn.example.com/song.mp3');
  other.audio.refuse = Object.assign(new Error('nope'), { name: 'NotSupportedError' });
  other.player.play();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(other.player.state().status, 'error');
  assert.match(other.player.state().error, /isn’t an audio file/);

  const blocked = withPlayer();
  blocked.player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  blocked.audio.refuse = Object.assign(new Error('gesture'), { name: 'NotAllowedError' });
  blocked.player.play();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(blocked.player.state().status, 'paused');
  assert.match(blocked.player.state().error, /press ▶️ Play/);
});

test('a finished track stops at the end, and the window hears about every change', async () => {
  const { audio, player } = withPlayer();
  let heard = 0;
  const off = player.subscribe(() => heard++);
  player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  assert.ok(heard > 0, 'loading told the window');
  const before = heard;
  audio.fire('ended');
  assert.equal(player.state().status, 'stopped');
  assert.ok(heard > before);
  off();
  audio.fire('timeupdate');
  assert.equal(heard, before + 1, 'a window that closed stops hearing');
});

test('letting go of the player takes its element listeners off', async () => {
  const { audio, player } = withPlayer();
  player.load('https://cdn.example.com/song.mp3');
  await Promise.resolve();
  assert.ok(audio.listeners > 0);
  player.dispose();
  assert.equal(audio.listeners, 0);
  assert.equal(audio.paused, true);
});
