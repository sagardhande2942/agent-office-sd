import type { AudioCore } from '../../sound/core';
/** Short synthesized cues run through the office master volume and mute controls. */
export function realitySound(a: AudioCore, kind: 'open' | 'dial' | 'cross') {
  a.unlock(); if (!a.ctx) return;
  a.count(`reality-${kind}`);
  const at = a.ctx.currentTime;
  if (kind === 'dial') { a.blip(a.alerts, at, 440, 1.4, 0.09, 0.04, 'sine'); return; }
  for (const [i, frequency] of (kind === 'open' ? [55, 82, 165] : [110, 220, 440]).entries()) {
    a.blip(a.alerts, at + i * 0.04, frequency, kind === 'open' ? 2.5 : 0.55, kind === 'open' ? 0.65 : 0.4, 0.035, 'sine');
  }
}
