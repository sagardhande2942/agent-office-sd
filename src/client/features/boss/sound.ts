import type { AudioCore } from '../../sound/core';

/** Uses the existing alerts bus and mute controls; never creates a separate AudioContext. */
export function intercom(a: AudioCore) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('intercom');
  for (const [i, frequency] of [523.25, 659.25].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime + i * 0.15;
    o.frequency.value = frequency;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(a.alerts);
    o.start(t);
    o.stop(t + 0.32);
  }
}
