import type { WorldsRequest } from '../parallel-worlds.js';

export type WorldsClientMsg =
  | { t: 'worlds.start'; floor: string; request: WorldsRequest }
  | { t: 'worlds.control'; floor: string; experiment: string; action: 'select' | 'archive' | 'feedback' | 'pr'; world?: string; text?: string };

export type WorldsServerMsg = { t: 'worlds.changed'; floor: string };
