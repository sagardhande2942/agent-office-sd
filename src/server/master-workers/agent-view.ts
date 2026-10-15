import type { TeamState, TeamRun, TeamTask } from '../../shared/master-workers.js';
import type { TeamRead } from '../../shared/team-coordination.js';
const brief=(value: string | undefined, limit=400)=>value && value.length>limit ? value.slice(0,limit)+'… (request task details)' : value;
export function dependencyContext(r: TeamRun, t: TeamTask) {
  return t.dependencies.map(id=>{const d=r.tasks.find(v=>v.id===id)!;return {id,status:d.status,acceptance:brief(d.acceptance),evidence:brief(d.evidence),commits:d.integrated?.slice(-5)};});
}
export function agentView(state: TeamState, actor: string, read: TeamRead = {}) {
  const r=state.current;
  if(!r)throw Error('No team activity');
  const master=actor===r.masterId;
  if(!master&&!r.workers.some(w=>w.workerId===actor))throw Error('Not a participant in this activity');
  const assigned=r.tasks.find(t=>t.attempts.at(-1)?.workerId===actor&&['running','review'].includes(t.status));
  const canRead=(t:TeamTask)=>master||assigned?.id===t.id||assigned?.dependencies.includes(t.id);
  const base={id:r.id,revision:r.revision,phase:r.phase,error:r.error};
  switch(read.view??'summary') {
    case 'task': {
      const task=r.tasks.find(t=>t.id===read.task);
      if(!task||!canRead(task))throw Error('Task unavailable to this participant');
      return {current:base,task,dependencies:dependencyContext(r,task)};
    }
    case 'plan': return {current:base,brief:master?r.brief:undefined,requirements:master?r.requirements:undefined,constraints:r.constraints,designSummary:master?r.designSummary:assigned?.attempts.at(-1)?.designSummary??r.designSummary,plan:master?r.plan:undefined,assignment:assigned?{id:assigned.id,instructions:assigned.instructions,specification:assigned.specification}:undefined};
    case 'history': {
      if(!master)throw Error('Only the master can read team history');
      const offset=read.offset??0;
      if(!Number.isInteger(offset)||offset<0)throw Error('Invalid history offset');
      const events=r.replay?.events??[];
      return {current:base,events:events.slice(offset,offset+20),nextOffset:offset+20<events.length?offset+20:undefined,dropped:r.replay?.dropped??0};
    }
    case 'summary': {
      if(!master){const a=assigned?.attempts.at(-1);return {current:base,assignment:assigned?{id:assigned.id,title:assigned.title,instructions:assigned.instructions,acceptance:assigned.acceptance,files:assigned.files,specification:assigned.specification,assignmentId:a?.assignmentId,base:a?.base,acknowledgedAt:a?.acknowledgedAt,sequence:a?.progress?.sequence,correctionFeedback:a?.correctionFeedback}:undefined,designSummary:a?.designSummary??r.designSummary,dependencies:assigned?dependencyContext(r,assigned):[]};}
      return {current:{...base,brief:brief(r.brief,1000),models:r.models,maxWorkers:r.maxWorkers,pr:r.pr,tasks:r.tasks.map(t=>{
        const a=t.attempts.at(-1);
        return {id:t.id,title:t.title,status:t.status,dependencies:t.dependencies,workerId:a?.workerId,assignmentId:a?.assignmentId,attempts:a?[{workerId:a.workerId,assignmentId:a.assignmentId}]:[],summary:brief(a?.summary),correctionFeedback:brief(a?.correctionFeedback),progress:a?.progress?{step:brief(a.progress.step),at:a.progress.at,blocker:brief(a.progress.blocker)}:undefined,alerts:a?.alerts?.filter(v=>!v.clearedAt&&!v.response),replacedBy:t.replacedBy};
      })}};
    }
    default: throw Error('Unknown team view; update CLI/host or choose summary, task, plan, history');
  }
}
export function actionReceipt(state: TeamState, taskId?: string) {
  const r=state.current!,t=r.tasks.find(t=>t.id===taskId),a=t?.attempts.at(-1);
  return {ok:true,current:{id:r.id,revision:r.revision,phase:r.phase,pr:r.pr},task:t?{id:t.id,status:t.status,assignmentId:a?.assignmentId,workerId:a?.workerId,sequence:a?.progress?.sequence}:undefined};
}
