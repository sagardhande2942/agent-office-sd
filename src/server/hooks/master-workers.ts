import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { team, teamAction } from '../master-workers/service.js';
import { readBody, send } from '../http/util.js';
import { WORKER_FEATURE_PATHS } from './worker-features.js';
/** Enforce team roles even when a participant bypasses advertised MCP tools. */
export async function workerTeam(ctx:Ctx,req:http.IncomingMessage,res:http.ServerResponse,url:URL):Promise<boolean> {
  if(!url.pathname.startsWith('/office/')) return false;
  const id=url.searchParams.get('worker')??'';
  const floor=ctx.workerFloor(id);
  const actor=floor?.workers.authenticate(id,(req.headers.authorization??'').replace(/^Bearer\s+/i,''));
  const endpoint=url.pathname==='/office/team';
  if(!actor||!floor) { if(endpoint){send(res,401,{error:'Send your worker ID and hook token'});return true;}return false; }
  const s=team(ctx,floor),role=s.member(id)??actor.masterWorkers?.role;
  if(endpoint) {
    try {
      if(!role) throw Error('Not a participant in this activity');
      if(req.method==='GET') send(res,200,s.state());
      else if(req.method==='POST') send(res,200,await teamAction(ctx,floor,id,JSON.parse((await readBody(req))||'{}')));
      else send(res,405,{error:'Use GET state or POST action'});
    } catch(e) { send(res,400,{error:(e as Error).message}); } return true;
  }
  if(role) {
    const allowed=['/office/workers','/office/workers/inbox','/office/workers/request','/office/workers/reply','/office/workers/ack','/office/workers/completion','/office/workers/complete',...WORKER_FEATURE_PATHS];
    if(!allowed.includes(url.pathname) || (url.pathname==='/office/workers'&&req.method!=='GET')) {send(res,403,{error:'Team participants use team actions; ordinary hiring, PR management and unrelated office operations are disabled'});return true;}
  }
  return false;
}
