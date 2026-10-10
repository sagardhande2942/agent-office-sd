/** Admits display callbacks without losing elapsed time on skipped frames. */
export class FrameClock {
  elapsed = 0;
  private last: number | null = null;
  private next = 0;
  private rate: number | null = null;

  frame(now: number, rate: number | null): number | null {
    if (rate === null) {
      this.last = null;
      this.rate = null;
      return null;
    }
    if (rate !== this.rate) {
      this.next = now;
      this.rate = rate;
    }
    if (rate > 0 && now + 0.5 < this.next) return null;
    const delta = this.last === null ? 0 : Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += delta;
    if (rate > 0) {
      const interval = 1000 / rate;
      this.next += interval;
      // Drop missed deadlines rather than attempting catch-up work after a stall.
      if (this.next <= now) this.next = now + interval;
    }
    return delta;
  }
}
