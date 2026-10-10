import { CINEMA_OFF, cinemaTitle, SHOT_BYTES_MAX, type CinemaState } from '../../shared/cinema.js';
import { checkPng } from '../office-workers.js';
import type { FloorCinema } from './surface.js';

/** A bounded, floor-specific cache; no paths on the host ever reach the office. */
export class RemoteCinema implements FloorCinema {
  private current: CinemaState = CINEMA_OFF;
  private cache = new Map<string, Buffer>();
  private pending = new Map<string, Promise<Buffer | string | undefined>>();
  private generation = 0;
  constructor(private call: (t: string, body?: Record<string, unknown>) => Promise<unknown>, private online: () => boolean, private supported: () => boolean) {}
  state() { return this.current; }
  title() { return cinemaTitle(this.current); }
  reset() { this.generation++; this.cache.clear(); this.pending.clear(); }
  receive(msg: { state: CinemaState; hostNow?: number }) {
    if (!msg.state || !Array.isArray(msg.state.reels)) return;
    // Translate the host's timeline once. Browsers and late arrivals use the office clock.
    const s = msg.state;
    if (Number.isFinite(msg.hostNow) && Number.isFinite(s.at) && s.on) s.at = Date.now() - Math.max(0, msg.hostNow! - s.at);
    this.current = s;
    const ids = new Set(s.reels.map(r => r.id));
    for (const key of this.cache.keys()) if (!ids.has(key.split(':')[0])) this.cache.delete(key);
  }
  private async command(t: string, body: Record<string, unknown> = {}) {
    if (!this.supported()) return 'Update the floor host to support the screening room';
    return this.call(t, body);
  }
  async play(reel: string, frame: unknown, by?: string) {
    const r = await this.command('cinema.play', { reel, frame, by });
    return typeof r === 'string' ? { error: r } : r as { changed: boolean } | { error: string };
  }
  async pause(frame: unknown, by?: string) { return await this.command('cinema.pause', { frame, by }) as boolean | string; }
  async stop(by?: string) { return await this.command('cinema.stop', { by }) as boolean | string; }
  async remove(reel: string, by?: string) { return await this.command('cinema.remove', { reel, by }) as boolean | string; }
  async frame(reel: string, n: number): Promise<Buffer | string | undefined> {
    const has = () => this.current.reels.some(r => r.id === reel && Number.isInteger(n) && n >= 0 && n < r.shots.length);
    if (!has()) return undefined;
    if (!this.online()) return 'The floor host is offline; reconnect it to load this shot';
    const key = `${reel}:${n}`;
    const cached = this.cache.get(key); if (cached) return cached;
    const existing = this.pending.get(key); if (existing) return existing;
    // Bound simultaneous transfers as well as retained bytes.
    if (this.pending.size >= 8) return 'The screening room is busy; retry shortly';
    const generation = this.generation;
    const request = (async () => {
      const result = await this.command('cinema.shot', { reel, n });
      if (typeof result === 'string') return result;
      if (!result || typeof result !== 'object' || !('image' in result)) return undefined;
      const raw = (result as { image: unknown }).image;
      if (typeof raw !== 'string' || raw.length > Math.ceil(SHOT_BYTES_MAX * 4 / 3) + 32) return 'Invalid screenshot from the floor host';
      const png = checkPng(raw);
      if (typeof png === 'string') return png;
      if (generation !== this.generation || !has() || !this.online()) return undefined;
      this.cache.set(key, png);
      while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
      return png;
    })();
    this.pending.set(key, request);
    try { return await request; } finally { if (this.pending.get(key) === request) this.pending.delete(key); }
  }
}
