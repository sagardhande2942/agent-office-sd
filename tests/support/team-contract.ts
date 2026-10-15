import type { TeamAction } from '../../src/shared/master-workers.js';
import type { TeamCoordinator } from '../../src/server/master-workers/coordinator.js';
export function fixturePlan(body:any):any {
  if(body.action!=='plan')return body;
  return {...body,designSummary:body.designSummary??'Use existing module interfaces; implement each scoped outcome and review before integration.',tasks:body.tasks.map((t:any)=>({...t,specification:t.specification??{kind:t.files.length?'implementation':'research',steps:['Inspect existing patterns','Complete the assigned outcome','Verify acceptance conditions'],references:['README.md'],decisions:'Preserve existing interfaces and authorization behavior',exclusions:'No unrelated modules or runtime dependencies',verification:t.files.length?['npm run typecheck']:['Report file references and evidence supporting the answer']}}))};
}
export async function fixtureAction(s:TeamCoordinator,actor:string,body:any) {
  body=fixturePlan(body);
  let r=s.state().current!;
  if(body.action==='result'){
    const t=r.tasks.find(t=>t.id===body.task),a=t?.attempts.at(-1);
    if(t?.status==='running'&&a?.workerId===actor&&a.assignmentId){
      await s.action(actor,{action:'acknowledge',id:r.id,task:body.task,assignmentId:a.assignmentId});
      body={...body,assignmentId:a.assignmentId};r=s.state().current!;
    }
  }
  return s.action(actor,{id:r.id,revision:r.revision,...body} as TeamAction);
}
export async function fixtureHttpAction(call:(actor:string,path:string,body?:any)=>Promise<any>,actor:string,body:any) {
  body=fixturePlan(body);
  const state=(await call(actor,'/office/team')).body;
  if(body.action==='result'&&state.assignment?.assignmentId){
    const assignmentId=state.assignment.assignmentId;
    await call(actor,'/office/team',{action:'acknowledge',id:state.current.id,task:body.task,assignmentId});
    body={...body,assignmentId};
  }
  return call(actor,'/office/team',{id:state.current.id,revision:state.current.revision,...body});
}
