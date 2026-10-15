import { randomUUID } from 'node:crypto';
import type { TeamRun, TeamTask, TeamAttempt, TeamAction } from '../../shared/master-workers.js';
import type { TaskAlert } from '../../shared/team-coordination.js';
import { recordEvent } from '../task-replay/index.js';
import { text } from './storage.js';
export const metrics=(r:TeamRun)=>r.metrics??=( {responseBytes:0,masterNotices:0,corrections:0,retries:0,takeovers:0} );
export function notify(r:TeamRun,message:string) {
  if(!r.masterId)return;
  const old=r.notifications[r.masterId]??'';
  if(!old.includes(message)){const next=old.length+message.length>12000?'Additional team updates pending; read compact team_state.':message;if(!old.includes(next))r.notifications[r.masterId]=(old+'\n'+next).trim();}
}
export function alert(r:TeamRun,t:TeamTask,a:TeamAttempt,kind:TaskAlert['kind'],message:string,now:number) {
  a.alerts??=[];
  if(a.alerts.some(v=>v.kind===kind&&!v.clearedAt&&v.message===message))return false;
  for(const v of a.alerts)if(v.kind===kind&&!v.clearedAt)v.clearedAt=now;
  a.alerts.push({id:randomUUID(),kind,message,at:now});a.alerts=a.alerts.slice(-20);
  notify(r,`Task ${t.id}: ${message}. Read the compact team summary, inspect evidence and record checkpoint.`);
  recordEvent(r,{type:'blocker',taskId:t.id,participantId:a.workerId,summary:message,details:{message:`Assignment ${a.assignmentId}; observed at ${now}. Missing reports mean progress unknown, not failure.`}});
  return true;
}
export function report(r:TeamRun,actor:string,b:Extract<TeamAction,{action:'acknowledge'|'progress'}>,now:number) {
  const t=r.tasks.find(t=>t.id===b.task),a=t?.attempts.at(-1);
  if(!t||t.status!=='running'||a?.status!=='running'||!a.assignmentId||a.workerId!==actor||a.assignmentId!==b.assignmentId)throw Error('No current assignment for this report');
  if(b.action==='acknowledge'){
    if(a.acknowledgedAt!==undefined)return false;
    a.acknowledgedAt=now;
    recordEvent(r,{type:'progress',taskId:t.id,participantId:actor,summary:'Assignment acknowledged',details:{message:a.assignmentId}});return true;
  }
  if(a.acknowledgedAt===undefined)throw Error('Acknowledge the assignment before reporting progress');
  if(!Number.isSafeInteger(b.sequence)||b.sequence<1)throw Error('Use a positive report sequence');
  const p={sequence:b.sequence,step:text(b.step,'current step',1000),completed:text(b.completed,'completed work',2000),checks:text(b.checks,'reported checks',2000),next:text(b.next,'next action',1000),...(b.blocker?{blocker:text(b.blocker,'blocker',2000)}:{})};
  if(a.progress&&b.sequence<=a.progress.sequence){
    const {at:_,...previous}=a.progress;
    if(JSON.stringify(previous)===JSON.stringify(p))return false;
    throw Error('Stale or conflicting progress sequence');
  }
  a.progress={...p,at:now};
  for(const v of a.alerts??[])if(!v.clearedAt&&(v.kind==='unknown'||(v.kind==='blocker'&&!p.blocker)))v.clearedAt=now;
  if(p.blocker)alert(r,t,a,'blocker',p.blocker,now);
  recordEvent(r,{type:'progress',taskId:t.id,participantId:actor,summary:`Progress ${p.sequence}: ${p.step}`,details:{evidence:p.completed,reportedChecks:p.checks,message:'Next: '+p.next+'\nBlocker: '+(p.blocker??'none')}});
  return true;
}
export function monitor(r:TeamRun,t:TeamTask,a:TeamAttempt,now:number) {
  if(!a.assignmentId||a.startedAt===undefined)return false; // Legacy assignments carry no invented timing.
  let changed=false;
  const since=Math.max(a.reportingSince??a.startedAt,a.progress?.at??a.acknowledgedAt??a.startedAt);
  if(now-since>=4*60000)changed=alert(r,t,a,'unknown','Progress unknown: no report for four minutes; inspect tools and observations before intervening',now)||changed;
  const estimate=t.specification?.expectedMinutes;
  if(estimate&&now-a.startedAt>estimate*60000)changed=alert(r,t,a,'estimate',`Elapsed work exceeds the ${estimate}-minute estimate; assess remaining scope`,now)||changed;
  return changed;
}
export function checkpoint(r:TeamRun,task:string,alertId:string,response:string,now:number) {
  const t=r.tasks.find(t=>t.id===task),a=t?.attempts.at(-1),v=a?.alerts?.find(v=>v.id===alertId);
  if(!t||!v)throw Error('Unknown alert');
  v.response=text(response,'master response',4000);v.respondedAt=now;
  recordEvent(r,{type:'review',taskId:task,participantId:r.masterId,summary:'Master monitoring response',details:{reviewReason:v.response,message:v.message}});
}
