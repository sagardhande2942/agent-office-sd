import type { WorkerInfo } from '../../shared/protocol.js';
import type { TeamRole } from '../../shared/protocol/master-workers.js';
export function restoreTeamRole(value:unknown):TeamRole|undefined {
  const v=value as TeamRole;
  if(!v||typeof v.id!=='string'||v.id.length>80||!['master','worker'].includes(v.role))return;
  if(v.task!==undefined&&(typeof v.task!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v.task)))return;
  return {id:v.id,role:v.role,...(v.task?{task:v.task}:{})};
}

export function teamTargetError(info:WorkerInfo|undefined):string|undefined {
  return info?.masterWorkers ? 'This participant is managed by Master / Workers; use its activity controls or terminal' : undefined;
}
export function teamPromptError(info:WorkerInfo,by?:string):string|undefined { return by==='Master / Workers'?undefined:teamTargetError(info); }
