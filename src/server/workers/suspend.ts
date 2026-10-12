import type { Worker } from './types.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { safeEq } from './util.js';
import { clockWork } from './clock.js';
export function authenticated(w:Worker|undefined,token:string):WorkerInfo|undefined {
  return (w?.pty||w?.dsh)&&token&&safeEq(token,w.hookToken)?w.info:undefined;
}
/** Stop a terminal while retaining its identity, session and worktree for explicit resume. */
export function suspendWorker(w:Worker|undefined,changed:()=>void):string|undefined {
  if(!w)return 'Worker no longer exists';
  const proc=w.pty,session=w.dsh;w.pty=undefined;w.dsh=undefined;clearTimeout(w.scanTimer);
  w.info.suspended=true;clockWork(w.info,'offline');w.info.status='offline';w.interrupted=false;
  try{session?.close();proc?.kill();}catch{}
  changed();return undefined;
}

export function wakeEligible(workers:Iterable<Worker>,resume:(id:string)=>unknown,reachable:(info:WorkerInfo)=>boolean) {
  for(const w of workers)if(!w.pty&&!w.dsh&&!w.info.suspended&&reachable(w.info))resume(w.info.id);
}
