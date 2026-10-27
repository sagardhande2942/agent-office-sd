import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { CommunicationsState } from '../../shared/communications.js';
import type { MeetingRequest, ServerMsg } from '../../shared/protocol.js';
import { isMeetingPattern, meetingDefinition } from '../../shared/meetings.js';
import { DEFAULT_WORKFLOW, workflowProblem } from '../../shared/meeting-workflows.js';
import { send } from '../http/util.js';
import { str } from '../office/input.js';
import { handoffInbox } from '../handoff/service.js';
import { floorCommunications } from '../hooks/communications.js';
export function meetingHostCommunications(floor: Floor): CommunicationsState {
  try { return handoffInbox(floor).state(); }
  catch (error) { return { messages: [], error: `Communications unavailable: ${(error as Error).message}` }; }
}
export const meetingHostSnapshot = (floor: Floor): ServerMsg => ({ t: 'communications', state: meetingHostCommunications(floor) });
/** Host execution keeps credentials, files, and every meeting engine on this machine. */
export function meetingHostCalls(floors: Map<string, Floor>, seatLimit: number): Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> {
  return {
    'meeting-space.create': (floor, msg) => floor.meetings.create(msg.name),
    'meeting-space.rename': (floor, msg) => floor.meetings.rename(str(msg.id, 80), msg.name),
    'meeting.stop': (floor, msg) => floor.meetings.stop(str(msg.by, 100), msg.spaceId === undefined ? undefined : str(msg.spaceId, 80)),
    'meeting.clear': (floor, msg) => floor.meetings.clear(str(msg.by, 100), msg.spaceId === undefined ? undefined : str(msg.spaceId, 80)),
    'meeting.finish': (floor, msg) => msg.allowUnresolved === true ? floor.meetings.finishAnyway(str(msg.id, 80), str(msg.by, 100)) : 'Confirm finishing with unresolved requests',
    'meeting.start': async (floor, msg) => {
      const req = msg.req as MeetingRequest | undefined;
      if (!req || typeof req !== 'object' || !isMeetingPattern(req.pattern)) return 'Unknown meeting pattern';
      if (req.roles !== undefined && !Array.isArray(req.roles)) return 'Meeting roles must be a list';
      const workflow=req.pattern==='custom'?req.workflow??DEFAULT_WORKFLOW:undefined;
      if(workflow) { const bad=workflowProblem(workflow);if(bad)return bad; }
      const pattern=meetingDefinition({pattern:req.pattern,workflow});
      const count = req.roles?.length || pattern.seats.default;
      if (count < pattern.seats.min || count > pattern.seats.max) return 'Invalid meeting worker count';
      const provider = req.provider ?? floor.workers.officeDefault.provider;
      if (!floor.project.agentProviders.includes(provider)) return 'Select a provider installed on the floor host';
      if (msg.owner !== undefined && typeof msg.owner !== 'string') return 'Invalid meeting owner';
      const grant = msg.capacity as { room?: unknown; paused?: unknown } | undefined;
      if (!grant || (grant.room !== null && (typeof grant.room !== 'number' || !Number.isInteger(grant.room) || grant.room < 0))) return 'Missing or invalid office meeting capacity';
      const refused = () => {
        if (grant.paused) return str(grant.paused, 1000);
        if (grant.room !== null && (grant.room as number) < count) return 'The office is at its worker limit';
        const used = [...floors.values()].reduce((n, f) => n + f.workers.list().length, 0);
        if (seatLimit > 0 && used + count > seatLimit) return 'The floor host is at its configured seat limit';
      };
      const error = refused(); if (error) return error;
      await floor.workers.fetchBase();
      if (floors.get(floor.id) !== floor) return 'The floor closed while preparing its Git base';
      const afterFetch = refused(); if (afterFetch) return afterFetch;
      return floor.meetings.start(req, str(msg.by, 100), msg.owner as string | undefined);
    },
  };
}
/** The same persistent host inbox feeds round gates, saved notes, and the office's message view. */
export async function meetingHostInbox(floor: Floor | undefined, req: http.IncomingMessage, res: http.ServerResponse, url: URL, publish: (floor: Floor, msg: ServerMsg) => void): Promise<boolean> {
  if (!floor) return false;
  if (url.pathname === '/office/workers' && req.method === 'GET') {
    const id = url.searchParams.get('worker') ?? '';
    const actor = floor.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    if (!actor) send(res, 401, { error: 'Send your worker ID and hook token' });
    else send(res, 200, { floor: { id: floor.id, name: floor.def.name }, you: id, workers: floor.workers.list() });
    return true;
  }
  if (!['inbox', 'request', 'reply', 'ack'].some(action => url.pathname === `/office/workers/${action}`)) return false;
  try { await floorCommunications(floor, handoffInbox(floor), req, res, url); }
  catch (error) { send(res, 400, { error: (error as Error).message }); }
  publish(floor, meetingHostSnapshot(floor));
  floor.meetings.pump();
  return true;
}
