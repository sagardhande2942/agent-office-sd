import type { CinemaState } from '../../shared/cinema.js';
export interface FloorCinema {
  state(): CinemaState;
  title(): string;
  play(reel: string, frame: unknown, by?: string): { changed: boolean } | { error: string } | Promise<{ changed: boolean } | { error: string }>;
  pause(frame: unknown, by?: string): boolean | string | Promise<boolean | string>;
  stop(by?: string): boolean | string | Promise<boolean | string>;
  remove(reel: string, by?: string): boolean | string | Promise<boolean | string>;
  frame(reel: string, n: number): Buffer | string | undefined | Promise<Buffer | string | undefined>;
}
