import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick } from '../../sound/dsp';
const FRIDGE={x:-11.3,y:1,z:12.2};
export function soda(a: AudioCore) {
    const ctx = a.ctx;
    if (!ctx) return;
    a.count('soda');
    const out = a.panner({ x: a.listener.x, y: a.listener.y + 0.1, z: a.listener.z }, 0.6, 1);
    out.connect(a.ambience);
    const t0 = ctx.currentTime + 0.02;

    // The tab letting go: a bright tick, then the hiss of the pressure getting out of it.
    a.blip(out, t0, 1800, 0.4, 0.05, 0.07, 'triangle');
    const hiss = a.noise(a.buf.white);
    const hissGain = ctx.createGain();
    envelope(hissGain.gain, t0 + 0.05, [
      [0.06, 0.12],
      [0.5, 0.02],
    ]);
    hiss.connect(biquad(ctx, 'highpass', 3800, 0.7)).connect(hissGain).connect(out);
    hiss.start(t0 + 0.05);
    hiss.stop(t0 + 0.6);

    // Two swallows: a wet low gulp with a touch of fizz in it, the second a little lower.
    for (const [dt, f] of [
      [0.28, 210],
      [0.72, 175],
    ] as const) {
      const g = ctx.createGain();
      envelope(g.gain, t0 + dt, [
        [0.04, 0.3],
        [0.26, 0],
      ]);
      const wobble = a.noise(a.buf.gurgle, true);
      wobble.connect(g.gain);
      g.connect(biquad(ctx, 'lowpass', f * 4, 1.1)).connect(out);
      wobble.start(t0 + dt);
      wobble.stop(t0 + dt + 0.3);
      a.blip(out, t0 + dt, f, 0.6, 0.16, 0.09, 'sine');
    }
  }
export function fridgeDoor(a: AudioCore, open: boolean) {
    const ctx = a.ctx;
    if (!ctx) return;
    a.count(open ? 'fridge-open' : 'fridge-close');
    const out = a.panner(FRIDGE, 1.6, 1.2);
    out.connect(a.ambience);
    const t0 = ctx.currentTime + 0.02;
    if (open) {
      // The seal pops, then the door swings away, pulling a little air with it.
      a.blip(out, t0, 230, 0.55, 0.08, 0.11);
      const air = a.noise(a.buf.white);
      const g = ctx.createGain();
      envelope(g.gain, t0, [
        [0.11, 0.05],
        [0.34, 0],
      ]);
      air.connect(biquad(ctx, 'bandpass', 900, 0.8)).connect(g).connect(out);
      air.start(t0);
      air.stop(t0 + 0.4);
    } else {
      // The swing, then the latch: a low knock with a bright catch over it.
      a.play(pick(a.buf.steps), { gain: 0.32, rate: 0.7, dest: out, when: t0 });
      a.blip(out, t0 + 0.16, 105, 0.55, 0.2, 0.15);
      a.blip(out, t0 + 0.175, 260, 0.95, 0.09, 0.05, 'triangle');
    }
  }
