/**
 * The smart speaker's window: paste a direct link to an audio file, load it, and play it from the
 * speaker. The transport (play, pause, stop, restart, the links loaded this session), the scrubber,
 * your own volume and mute, and what's playing — the music keeps going when the window is minimized
 * with ✕ or Esc, and only ⏹️ Stop (or leaving the office) ends it.
 */
import { h, openModal, toast } from '../../ui/dom';
import { audioLinkNote, checkAudioUrl } from './url';
import { clock, statusLabel, type SpeakerPlayer } from './player';

/** The fill a range draws its track from (see .volume in the office's stylesheets). */
function fill(el: HTMLInputElement): void {
  const max = Number(el.max) || 1;
  el.style.setProperty('--fill', `${Math.min(100, (Number(el.value) / max) * 100)}%`);
}

/** Opens the speaker's music player, driving `player` (the one audio element of the session). */
export function openSpeaker(player: SpeakerPlayer) {
  const close = h('button.btn.close', { 'aria-label': 'Minimize', title: 'Minimize — the music keeps playing' }, '✕');
  const art = h('span.sp-art', {}, '🔊');
  const title = h('div.svc-title', {}, 'No track loaded');
  const meta = h('div.svc-meta', {}, 'Paste a direct audio link below');
  const now = h('div.sp-now', {}, art, h('div.svc-main', {}, title, meta));

  const prev = h('button.btn', { type: 'button', title: 'The link before this one' }, '⏮️');
  const play = h('button.btn.primary', { type: 'button' }, '▶️ Play');
  const stop = h('button.btn', { type: 'button', title: 'Stop and go back to the start' }, '⏹️ Stop');
  const next = h('button.btn', { type: 'button', title: 'The link after this one' }, '⏭️');
  const restart = h('button.btn', { type: 'button', title: 'Start this track again' }, '🔁 Restart');
  const transport = h('div.sp-transport', { role: 'group', 'aria-label': 'Playback' }, prev, play, stop, next, restart);

  const scrub = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', 'aria-label': 'Where the track is' }) as HTMLInputElement;
  const time = h('span.sp-time', {}, '0:00 / 0:00');
  const progress = h('div.volume.sp-progress', {}, scrub, time);

  const mute = h('button.btn', { type: 'button' }, '🔇 Mute');
  const level = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Speaker volume' }) as HTMLInputElement;
  const pct = h('span.vol-pct');
  const sound = h('div.volume', {}, mute, level, pct);

  const url = h('input', { type: 'text', placeholder: 'https://… a direct .mp3, .m4a, .ogg, .wav…', 'aria-label': 'Audio link', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const load = h('button.btn.primary', { type: 'button' }, '📥 Load Music');
  const note = h('p.setting-note.sp-link-note');
  const problem = h('p.setting-note.bad.sp-problem');

  const el = h(
    'div.modal.speaker',
    { role: 'dialog', 'aria-label': 'Smart speaker' },
    h('header', {}, h('h2', {}, '🔊 Smart speaker'), close),
    h(
      'div.body',
      {},
      now,
      transport,
      progress,
      h('label', { style: 'margin-top:16px' }, 'Your sound'),
      sound,
      h('label', { style: 'margin-top:16px' }, 'Play a link'),
      h('div.webhook', {}, url, load),
      note,
      problem,
    ),
    h(
      'footer',
      {},
      h('span.grow', {}, 'It plays from the speaker in the lounge and fades as you walk away; your volume is yours alone. Minimizing keeps the music going.'),
      h('button.btn', { type: 'button', title: 'Close the window and keep playing', onclick: () => modal.close() }, '➖ Minimize'),
    ),
  );

  /** What this window last put in the link box, so a track chosen elsewhere doesn't eat what you typed. */
  let boxed = '';

  const render = () => {
    const s = player.state();
    art.textContent = s.status === 'playing' ? '🎶' : '🔊';
    art.classList.toggle('spin', s.status === 'playing');
    title.textContent = s.title || 'No track loaded';
    meta.textContent = [statusLabel(s.status), s.url ? (s.muted ? 'muted' : `${Math.round(s.volume * 100)}% volume`) : ''].filter(Boolean).join(' · ');
    play.textContent = s.status === 'playing' ? '⏸️ Pause' : '▶️ Play';
    play.classList.toggle('primary', s.status !== 'playing');
    play.title = s.status === 'playing' ? 'Pause where it is' : 'Carry on, or play what you pasted';
    prev.disabled = !s.canPrev;
    next.disabled = !s.canNext;
    stop.disabled = !s.url;
    restart.disabled = !s.url;
    const total = s.duration;
    if (document.activeElement !== scrub) {
      scrub.max = String(total || 1);
      scrub.value = String(Math.min(s.currentTime, total || 1));
      fill(scrub);
    }
    time.textContent = total ? `${clock(s.currentTime)} / ${clock(total)}` : clock(s.currentTime);
    const v = Math.round(s.volume * 100);
    if (document.activeElement !== level) level.value = String(v);
    fill(level);
    pct.textContent = s.muted ? 'Muted' : `${v}%`;
    mute.textContent = s.muted ? '🔊 Unmute' : '🔇 Mute';
    mute.setAttribute('aria-pressed', String(s.muted));
    mute.classList.toggle('danger', s.muted);
    sound.classList.toggle('muted', s.muted);
    if (url.value === boxed) {
      boxed = s.url;
      url.value = boxed;
    }
    const warning = url.value.trim() ? audioLinkNote(url.value.trim()) : null;
    note.textContent = warning ?? 'A direct link to an audio file plays straight away; a link to a website that plays one usually won’t.';
    note.classList.toggle('bad', !!warning);
    problem.textContent = s.error;
    problem.style.display = s.error ? '' : 'none';
  };

  /** Loads whatever is in the box, once it's a link the player can try. */
  const loadLink = () => {
    const found = checkAudioUrl(url.value);
    if ('error' in found) {
      toast(found.error, 'warn');
      url.focus();
      render();
      return;
    }
    const warning = audioLinkNote(found.url);
    if (warning) toast(warning, 'warn');
    player.load(found.url);
    boxed = found.url;
    render();
  };

  load.addEventListener('click', loadLink);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadLink();
  });
  url.addEventListener('input', render);
  play.addEventListener('click', () => {
    const s = player.state();
    if (s.status === 'playing') player.pause();
    else if (s.url) player.play();
    else if (url.value.trim()) loadLink();
    else {
      toast('Paste a direct audio link first, then press 📥 Load Music', 'warn');
      url.focus();
    }
  });
  stop.addEventListener('click', () => player.stop());
  restart.addEventListener('click', () => player.restart());
  prev.addEventListener('click', () => player.prev());
  next.addEventListener('click', () => player.next());
  scrub.addEventListener('input', () => {
    time.textContent = `${clock(Number(scrub.value))} / ${clock(Number(scrub.max))}`;
    fill(scrub);
  });
  scrub.addEventListener('change', () => player.seek(Number(scrub.value)));
  level.addEventListener('input', () => {
    // Dragging it turns the sound back on, like the office's other volume rows do.
    if (player.state().muted) player.setMuted(false);
    player.setVolume(Number(level.value) / 100);
    render();
  });
  mute.addEventListener('click', () => player.toggleMute());
  close.addEventListener('click', () => modal.close());

  const timer = setInterval(render, 250);
  const off = player.subscribe(render);
  const modal = openModal(el, {
    doing: '🎵 at the smart speaker',
    onClose: () => {
      clearInterval(timer);
      off();
    },
  });
  render();
}
