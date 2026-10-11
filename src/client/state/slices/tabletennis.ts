import { defaultPingPongState, type PingPongState } from '../../../shared/tabletennis';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Table tennis on the balcony (vs worker bot or multiplayer PvP). */
    pingpong: PingPongState;
  }
  interface Topics {
    pingpong: true;
  }
}

export const tableTennis: Slice = {
  init(s) {
    s.pingpong = defaultPingPongState();
  },
  on: {
    'pingpong.state'(s, m) {
      s.pingpong = m.state;
      return ['pingpong'];
    },
    'pingpong.point'(s, m) {
      if (s.pingpong) {
        s.pingpong.score = m.score;
      }
      return ['pingpong'];
    },
  },
  enter(s, v) {
    s.pingpong = v.pingpong ?? defaultPingPongState();
    return ['pingpong'];
  },
};
