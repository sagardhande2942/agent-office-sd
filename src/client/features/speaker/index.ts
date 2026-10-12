/**
 * The smart speaker: walk up to the tower in the lounge and press E to open its music player. Paste a
 * direct link to an audio file, load it, and it plays from the speaker — from ONE audio element for
 * the session (see player.ts), so two tracks never play over each other.
 *
 * While it plays, its rings, equalizer and floor glow animate (the tower's own work, see world.ts);
 * pause or stop and they go still. The music fades with how far you stand from the speaker and goes
 * silent on another floor or map, as the jukebox and the TV do — the track itself carries on, so it's
 * still playing when you walk back, until you stop it or leave the office.
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { clip } from '../../ui/dom';
import { HUD_ACTIONS } from '../../ui/menu';
import { SpeakerPlayer } from './player';
import { openSpeaker } from './ui';
import './ui.css';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    speaker: true;
  }
}

/** The speaker's music player, open to the ☰ menu as well as to E at the tower. */
export function installSpeaker(ctx: Ctx) {
  const player = new SpeakerPlayer();

  ctx.interactions.define('speaker', {
    reach: 3.2,
    hint: () => {
      const s = player.state();
      const what = s.title ? `${s.status === 'playing' ? '♪ ' : ''}${clip(s.title, 34)}` : 'nothing loaded';
      return { k: `${s.status}|${s.title}`, parts: [hintTitle('🔊 Smart speaker'), aside(what), key('E', 'Music player')] };
    },
    use: onE(() => openSpeaker(player)),
  });

  // Each frame: the tower breathes with the beat while it plays, and how loud its music reaches you is
  // how far you stand from it (and whether you're on its floor at all). Off the office's own map (a
  // castle, the station) there's no speaker to hear, so the player stops rather than playing on mute.
  ctx.ticks.add('world', ({ t, dt }) => {
    if (!ctx.inOffice()) {
      if (player.playing()) player.pause();
      return;
    }
    const speaker = ctx.office.speaker;
    if (!speaker) return;
    speaker.setPlaying(player.playing());
    speaker.update(t, dt, ctx.reduceMotion.matches);
    const ears = ctx.player.pos;
    const { at } = speaker;
    // You can only hear it on a floor of the office: up on the roof it's out of earshot.
    player.setRoom(Math.hypot(ears.x - at.x, ears.y - at.y, ears.z - at.z), !ctx.upTop());
  });

  // The window is in the ☰ menu too, so it can be opened without walking to the tower.
  HUD_ACTIONS.push({ id: 'speaker', icon: '🔊', label: 'Smart speaker', section: 'Open', title: () => 'Paste a direct audio link and play it from the speaker in the lounge', run: () => openSpeaker(player) });

  return { player, show: () => openSpeaker(player) };
}
