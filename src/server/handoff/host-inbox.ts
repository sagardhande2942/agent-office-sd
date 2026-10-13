import type http from 'node:http';
import type { Floor } from '../floor.js';
import { floorCommunications } from '../hooks/communications.js';
import { handoffInbox } from './service.js';
/** Host-local workers share the same tracked inbox as handoff offers and team workers. */
export async function hostTrackedInbox(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!floor || !['inbox', 'request', 'reply', 'ack'].some(action => url.pathname === `/office/workers/${action}`)) return false;
  await floorCommunications(floor, handoffInbox(floor), req, res, url); return true;
}
