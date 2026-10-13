import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { floorWorkerLore } from '../lore/hooks.js';
import { send } from '../http/util.js';
import { loadKnowledgeConfig } from './settings.js';
/** Transitional endpoint: old JSON memory is opt-in, never a second default store. */
export async function floorWorkerLegacyLore(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL, publish: (msg: ServerMsg) => void) {
  if (floor && !loadKnowledgeConfig(floor.def.dir).legacyLore) {
    const id = url.searchParams.get('worker') ?? ''; const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!floor.workers.authenticate(id, token)) return send(res, 401, { error: 'Send your own worker ID and hook token' });
    return send(res, 410, { error: 'Legacy Lore is disabled; use office-workers knowledge or knowledge_* tools. Import old notes with agent-office knowledge migrate.' });
  }
  return floorWorkerLore(floor, req, res, url, publish);
}
