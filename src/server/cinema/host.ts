import type { Floor } from '../floor.js';
import { SHOT_BYTES_MAX } from '../../shared/cinema.js';
/** Register these calls on the floor-host wire; image replies fit under its existing 2 MiB cap. */
export const cinemaHostCalls: Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> = {
  'cinema.play': (f, m) => f.cinema.play(typeof m.reel === 'string' ? m.reel.slice(0, 32) : '', m.frame, String(m.by ?? '')),
  'cinema.pause': (f, m) => f.cinema.pause(m.frame, String(m.by ?? '')),
  'cinema.stop': (f, m) => f.cinema.stop(String(m.by ?? '')),
  'cinema.remove': (f, m) => f.cinema.remove(typeof m.reel === 'string' ? m.reel.slice(0, 32) : '', String(m.by ?? '')),
  'cinema.shot': (f, m) => {
    if (typeof m.reel !== 'string' || typeof m.n !== 'number' || !Number.isInteger(m.n)) return null;
    const png = f.cinema.frame(m.reel, m.n);
    return png && png.length <= SHOT_BYTES_MAX ? { image: png.toString('base64') } : null;
  },
};
export const cinemaHostState = (floor: Floor) => ({ t: 'cinema', state: floor.cinema.state(), hostNow: Date.now() });
