import { DESK_BY_ID } from '../../shared/layout.js';
import type http from 'node:http';
import type { Floor } from '../floor.js';
import { readBody, send } from '../http/util.js';
import { KnowledgeStore } from './store.js';
import { loadKnowledgeConfig } from './settings.js';
import { researchMeetingFor, meetingKnowledgeAllowed, assertMeetingWrite, recordMeetingReview } from './meetings.js';
import type { WorkerInfo } from '../../shared/protocol.js';
const allowed = (floor: Floor, w: WorkerInfo) => w.kind === 'agent' && !w.helper && !w.planReview?.locked &&
  (w.meeting ? meetingKnowledgeAllowed(floor, w) : !DESK_BY_ID.get(w.deskId)?.station);
export const KNOWLEDGE_WORKER_TOOLS = ['index', 'read', 'search', 'write', 'move', 'archive', 'review_done'].map(action => ({ name: `knowledge_${action}`, readOnly: ['index', 'read', 'search'].includes(action) }));
export async function floorWorkerKnowledge(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const id = url.searchParams.get('worker') ?? ''; const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const worker = floor?.workers.authenticate(id, token);
  if (!floor || !worker) return send(res, 401, { error: 'Send your own worker ID and hook token' });
  if (!allowed(floor, worker)) return send(res, 403, { error: 'Only coding workers or active research meeting participants may use knowledge tools' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST a knowledge action' });
  try {
    const body = JSON.parse(await readBody(req, 256 * 1024)) as Record<string, unknown>;
    const active = floor.workers.authenticate(id, token);
    if (!active) return send(res, 401, { error: 'Worker session changed while reading request' });
    if (!allowed(floor, active)) return send(res, 403, { error: 'Worker role changed while reading request' });
    if (Object.keys(body).some(k => !['action', 'path', 'offset', 'limit', 'query', 'scope', 'frontmatter', 'body', 'template', 'from', 'to', 'reason', 'changed', 'none_reason', 'expectedVersion'].includes(k))) throw Error('Unknown knowledge field; identity is server-owned');
    if (body.expectedVersion !== undefined && body.expectedVersion !== null && typeof body.expectedVersion !== 'string') throw Error('expectedVersion must be the version from knowledge_read, or null for a new note');
    const expectedVersion = (body.expectedVersion ?? null) as string | null;
    const store = new KnowledgeStore(floor.def.dir, loadKnowledgeConfig(floor.def.dir));
    store.seed(); let result: unknown;
    const meeting = researchMeetingFor(floor, active);
    if (meeting) assertMeetingWrite(meeting, active, body.action, body.path);
    switch (body.action) {
      case 'index': result = { text: store.index(body.path as string | undefined) }; break;
      case 'read': result = store.read(body.path as string, body.offset as number | undefined, body.limit as number | undefined); break;
      case 'search': result = store.search(body.query as string, body.scope as string | undefined); break;
      case 'write': {
        if (body.frontmatter && typeof body.frontmatter === 'object' && ('author' in body.frontmatter || 'updated' in body.frontmatter)) throw Error('author and updated are server-owned');
        const templates: Record<string, string> = { howto: '## Steps\n\n## Verification\n', gotcha: '## Observation\n\n## Evidence\n\n## When this applies\n', decision: '## Decision\n\n## Rationale\n\n## Alternatives\n', module: '## Responsibilities\n\n## Interfaces\n\n## Verification\n' };
        if (body.template !== undefined && !Object.hasOwn(templates, String(body.template))) throw Error('Unknown template');
        const frontmatter = meeting ? { ...(body.frontmatter as object), status: 'needs-verification', pinned: false, verified_at: undefined, human_verified_by: undefined } : body.frontmatter;
        result = store.write(body.path as string, frontmatter as never, (body.body ?? templates[String(body.template)] ?? '') as string, `worker:${active.id}`, expectedVersion); break;
      }
      case 'move': result = store.move(body.from as string, body.to as string, expectedVersion); break;
      case 'archive': result = store.archive(body.path as string, body.reason as string, `worker:${active.id}`, expectedVersion); break;
      case 'review_done': result = meeting ? recordMeetingReview(floor.def.dir, meeting, active, body.changed, body.none_reason) : store.review(active.id, active.completionRevision ?? 0, body.changed as string[], body.none_reason as string | undefined); break;
      default: throw Error('Unknown knowledge action');
    }
    if (meeting && body.action === 'review_done') floor.meetings.pump();
    return send(res, 200, result);
  } catch (e) { return send(res, 400, { error: (e as Error).message }); }
}
