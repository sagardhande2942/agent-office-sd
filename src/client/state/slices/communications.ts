import type { CommunicationsState } from '../../../shared/communications';
import type { Slice } from '../store';

declare module '../store' {
  interface Store { communications: CommunicationsState; }
  interface Topics { communications: true; }
}

export const communications: Slice = {
  init(s) { s.communications = { messages: [] }; },
  on: { communications(s, m) { s.communications = m.state; return ['communications']; } },
  enter(s, v) { s.communications = v.communications ?? { messages: [] }; return ['communications']; },
};
