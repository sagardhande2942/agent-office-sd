import type http from 'node:http';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { readBody,send } from '../http/util.js';
import { floorBoss } from './service.js';
import type { BossWorkerAction } from '../../shared/boss-mode/types.js';
export async function bossWorkerHook(floor:Floor|undefined,req:http.IncomingMessage,res:http.ServerResponse,url:URL,_publish:(msg:ServerMsg)=>void){
  const id=url.searchParams.get('worker')??'';
  const actor=floor?.workers.authenticate(id,(req.headers.authorization??'').replace(/^Bearer\s+/i,''));
  if(!floor||!actor)return send(res,401,{error:'Send your worker ID and hook token'});
  try {
    const service=floorBoss(floor);
    if(!actor.bossMode)throw Error('Not a Boss-mode participant');
    if(req.method==='GET')send(res,200,service.state());
    else if(req.method==='POST')send(res,200,await service.engine.worker(id,JSON.parse(await readBody(req)) as BossWorkerAction));
    else send(res,405,{error:'Use GET state or POST action'});
  }catch(error){send(res,400,{error:(error as Error).message});}
}
