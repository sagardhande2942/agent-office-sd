import type { CommunicationsState } from '../communications.js';

declare module './floors.js' {
  interface FloorView {
    communications?: CommunicationsState;
  }
}

export type CommunicationsServerMsg = { t: 'communications'; state: CommunicationsState };
