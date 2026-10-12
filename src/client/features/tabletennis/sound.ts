import type { AudioCore } from '../../sound/core';
import { biquad, envelope, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

export type TableTennisSound = 'paddle' | 'table' | 'net' | 'point' | 'win';

/**
 * Procedural audio for table tennis on the balcony: paddle hits, table bounces,
 * net clips, and point/win chimes.
 */
export function playTableTennisSound(a: AudioCore, kind: TableTennisSound, at?: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`tabletennis-${kind}`);
  const out = at ? a.panner(at, 3, 1) : ctx.createGain();
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;

  switch (kind) {
    case 'paddle': {
      // Crisp woody "pock" with slight rubber click
      a.blip(out, t0, rand(950, 1100), 0.5, 0.04, 0.25, 'triangle');
      a.blip(out, t0, rand(450, 520), 0.7, 0.06, 0.18, 'sine');
      const click = a.noise(a.buf.white);
      const g = ctx.createGain();
      envelope(g.gain, t0, [
        [0.01, 0.08],
        [0.04, 0],
      ]);
      click.connect(biquad(ctx, 'bandpass', 1800, 2)).connect(g).connect(out);
      click.start(t0);
      click.stop(t0 + 0.05);
      break;
    }
    case 'table': {
      // Resonant hollow "ping" bounce off the table surface
      a.blip(out, t0, rand(680, 740), 0.6, 0.045, 0.22, 'triangle');
      a.blip(out, t0 + 0.005, rand(340, 370), 0.8, 0.05, 0.12, 'sine');
      break;
    }
    case 'net': {
      // Soft muffled net clip
      a.blip(out, t0, 260, 0.9, 0.05, 0.12, 'sine');
      break;
    }
    case 'point': {
      // High cheerful point score bell
      a.blip(out, t0, 880, 0.3, 0.08, 0.2, 'sine');
      a.blip(out, t0 + 0.08, 1174, 0.4, 0.12, 0.22, 'sine');
      break;
    }
    case 'win': {
      // Fanfare chords for winning the match
      const notes = [587, 740, 880, 1174];
      for (let i = 0; i < notes.length; i++) {
        a.blip(out, t0 + i * 0.07, notes[i], 0.3, 0.25, 0.22, 'triangle');
      }
      break;
    }
  }
}
