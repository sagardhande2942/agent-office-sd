import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { REELS_KEPT, showing, type CinemaState, type ReelShot, type ReelSummary } from '../shared/cinema.js';

/**
 * The screening room on one floor: the reels its workers have recorded, and which one is on the
 * screen, kept in .agent-office/cinema.json with each reel's pictures in .agent-office/cinema/<id>/.
 *
 * A reel is a handful of PNGs of the build with a caption each (see docs/cinema.md). Which shot is up
 * is four numbers, like the TV and the jukebox: every browser works out for itself which shot that is
 * on the office's clock, so nothing but a reel change or a play/pause goes over the wire.
 */
export class Cinema {
  private reels: ReelSummary[] = [];
  // Nothing on the screen is the room's own zero, so a floor nobody has recorded for reads as
  // CINEMA_OFF exactly, and `at` only ever means something while a reel is on.
  private s: { on: boolean; reel?: string; frame: number; playing: boolean; at: number } = { on: false, frame: 0, playing: false, at: 0 };
  private file: string;
  private dir: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'cinema.json');
    this.dir = path.join(dataDir, 'cinema');
    this.load();
  }

  state(): CinemaState {
    const { on, reel, frame, playing, at } = this.s;
    return { reels: this.reels, on, ...(reel ? { reel } : {}), frame, playing, at };
  }

  /** The reel on the screen, for the toast and the hint bar. */
  title(): string {
    return showing(this.state())?.title ?? 'nothing on';
  }

  /**
   * Adds a reel from its shots, newest first: `id` is a fresh one, the pictures go in their own
   * folder, and a reel that pushes the floor past REELS_KEPT takes the oldest with it.
   */
  add(reel: { title: string; pr?: number; by?: string; shots: ReelShot[] }, pictures: Buffer[]): ReelSummary {
    const id = reelId();
    const folder = path.join(this.dir, id);
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      pictures.forEach((png, i) => writeFileSync(path.join(folder, `${i}.png`), png, { mode: 0o600, flag: 'wx' }));
    } catch {
      // Pictures couldn't be kept: a reel with none of them is no demonstration, so it isn't added.
      rmSync(folder, { recursive: true, force: true });
      throw new Error("The screening room couldn't keep the pictures");
    }
    const summary: ReelSummary = { id, title: reel.title, ...(reel.pr ? { pr: reel.pr } : {}), ...(reel.by ? { by: reel.by } : {}), at: Date.now(), shots: reel.shots };
    this.reels = [summary, ...this.reels.filter((r) => r.id !== id)].slice(0, REELS_KEPT);
    this.forget();
    this.save();
    // The newest reel is what a screening room shows, so it goes up as it arrives.
    this.set({ on: true, reel: id, frame: 0, playing: true });
    return summary;
  }

  /** Takes a reel off the screen and off the floor. */
  remove(id: string, _by?: string): boolean {
    const reel = this.reels.find((r) => r.id === id);
    if (!reel) return false;
    this.reels = this.reels.filter((r) => r.id !== id);
    this.forget();
    if (this.s.reel === id) this.set({ on: false, reel: undefined, frame: 0, playing: false });
    this.save();
    return true;
  }

  /** Puts `id` on the screen from its first shot, or from `frame`; refuses one that isn't there. */
  play(id: string, frame: unknown, _by?: string): { changed: boolean } | { error: string } {
    const reel = this.reels.find((r) => r.id === id);
    if (!reel) return { error: 'No such reel in the screening room' };
    const at = reel.shots.length ? Math.min(Math.max(0, Number(frame) || 0), reel.shots.length - 1) : 0;
    this.set({ on: true, reel: id, frame: at, playing: true });
    return { changed: true };
  }

  /** Holds the reel where it is, so play picks it up from there. */
  pause(frame: unknown, _by?: string): boolean {
    if (!this.s.on || !this.s.playing) return false;
    this.set({ ...this.s, playing: false, frame: Math.max(0, Math.floor(Number(frame) || 0)) });
    return true;
  }

  /** Off; the reels stay for next time. */
  stop(_by?: string): boolean {
    if (!this.s.on) return false;
    this.set({ on: false, reel: undefined, frame: 0, playing: false });
    return true;
  }

  /**
   * One shot's picture, for the browser to draw. Only ever a shot of a reel this floor still lists, at
   * an index that reel has: an id that matches the shape is not enough, or a removed reel's pictures
   * would go on being served until `forget` swept them.
   */
  frame(id: string, n: number): Buffer | undefined {
    const reel = this.reels.find((r) => r.id === id);
    if (!reel || !Number.isInteger(n) || n < 0 || n >= reel.shots.length) return undefined;
    try {
      return readFileSync(path.join(this.dir, id, `${n}.png`));
    } catch {
      return undefined;
    }
  }

  private set(s: { on: boolean; reel?: string; frame: number; playing: boolean; at?: number }) {
    this.s = { ...s, at: s.at ?? Date.now() };
    this.save();
  }

  /** Drops the pictures of reels the floor no longer lists. */
  private forget() {
    let folders: string[];
    try {
      folders = readdirSync(this.dir);
    } catch {
      return;
    }
    const kept = new Set(this.reels.map((r) => r.id));
    for (const name of folders) if (!kept.has(name)) rmSync(path.join(this.dir, name), { recursive: true, force: true });
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { reels?: unknown; on?: unknown; reel?: unknown; frame?: unknown; playing?: unknown; at?: unknown };
      const list: unknown[] = Array.isArray(saved.reels) ? saved.reels : [];
      const reels: ReelSummary[] = list.flatMap((r) => { const reel = checkReel(r); return reel ? [reel] : []; }).slice(0, REELS_KEPT);
      // A reel whose pictures went missing isn't a demonstration any more.
      this.reels = reels.filter((r) => r.shots.every((_shot, i) => existsSync(path.join(this.dir, r.id, `${i}.png`))));
      const on = saved.on === true && this.reels.some((r) => r.id === saved.reel);
      this.s = {
        on,
        ...(typeof saved.reel === 'string' ? { reel: saved.reel } : {}),
        frame: Number.isInteger(saved.frame) && (saved.frame as number) >= 0 ? (saved.frame as number) : 0,
        playing: on && saved.playing === true,
        at: on && typeof saved.at === 'number' && Number.isFinite(saved.at) ? saved.at : 0,
      };
      this.forget();
    } catch {
      // A broken file just means an empty screening room.
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify({ ...this.s, reels: this.reels }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/** A reel id: twelve characters nothing else can be, so a picture folder is never named from outside. */
export function reelId(): string {
  return randomBytes(8).toString('hex').slice(0, 12);
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** A reel read back from disk, if it is one. */
export function checkReel(raw: unknown): ReelSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 32);
  const title = str(r.title, 80);
  const shots = Array.isArray(r.shots) ? r.shots.flatMap((s) => (checkShot(s) ? [s] : [])) : [];
  if (!/^[a-z0-9]{12}$/.test(id) || !title || !shots.length) return null;
  return {
    id,
    title,
    ...(int(r.pr, 1, 1_000_000) !== null ? { pr: int(r.pr, 1, 1_000_000)! } : {}),
    ...(str(r.by, 40) ? { by: str(r.by, 40) } : {}),
    at: int(r.at, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    shots,
  };
}

function checkShot(raw: unknown): ReelShot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const caption = str(s.caption, 160);
  const width = int(s.width, 1, 20_000);
  const height = int(s.height, 1, 20_000);
  return caption && width !== null && height !== null ? { caption, width, height } : null;
}
