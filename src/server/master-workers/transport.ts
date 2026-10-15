import type { TeamSession } from '../team-sessions.js';
import type { TeamAction } from '../../shared/master-workers.js';
import { agentView, actionReceipt } from './agent-view.js';
export function readTeamAgent(session:TeamSession,actor:string,url:URL) {
  const value={contractVersion:1,...agentView(session.state(),actor,{view:url.searchParams.get('view')??'summary',task:url.searchParams.get('task')??undefined,offset:url.searchParams.has('offset')?Number(url.searchParams.get('offset')):undefined})};
  session.recordResponse?.(Buffer.byteLength(JSON.stringify(value)));return value;
}
export async function actTeamAgent(session:TeamSession,actor:string,body:TeamAction) {
  const value={contractVersion:1,...actionReceipt(await session.action(actor,body),'task' in body?body.task:undefined)};
  session.recordResponse?.(Buffer.byteLength(JSON.stringify(value)));return value;
}
