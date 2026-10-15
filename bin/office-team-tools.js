// Team tools share the existing authenticated worker transport, with server-enforced roles.
const str={type:'string',minLength:1};
const strings={type:'array',items:str};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const choice=object({provider:str,model:str,effort:str},['provider','model']);
const specification=object({kind:{enum:['implementation','research']},steps:strings,references:strings,decisions:str,exclusions:str,verification:strings,expectedMinutes:{type:'number',exclusiveMinimum:0,maximum:1440}},['kind','steps','references','decisions','exclusions','verification']);
const task=object({id:str,title:str,instructions:str,acceptance:str,files:strings,dependencies:strings,specification},['id','title','instructions','acceptance','files','dependencies']);
const base={id:str,revision:{type:'integer',minimum:0}};
const variant=(action,properties,required=Object.keys(properties))=>object({...base,action:{const:action},...properties},['id','revision','action',...required]);
export const TEAM_TOOLS=[
  {name:'team_state',description:'Read compact role-specific team state. Use view:task with task ID for full evidence, view:plan for design, or master-only view:history (20 events/page with offset). Action receipts return revision; routine reports do not invalidate it.',inputSchema:object({view:{enum:['summary','task','plan','history']},task:str,offset:{type:'integer',minimum:0}},[]),annotations:{readOnlyHint:true}},
  {name:'team_action',description:'Operate on your team using its current id/revision. Master: publish plan, dispatch to an eligible model (one alternate-model retry), review after merging worker commits preserving ancestry, take over tasks, finish after verified open PR and checklist. Master also supports checkpoint, request_changes (one correction), and replace. Worker: acknowledge, progress or submit result, including failures. Read state after stale-revision errors. CLI: office-team.js --help.',inputSchema:{type:'object',oneOf:[
    variant('plan',{plan:str,designSummary:str,tasks:{type:'array',minItems:1,items:task}},['plan','tasks']),
    variant('dispatch',{task:str,choice,reason:str}),
    variant('result',{task:str,summary:str,commits:strings,checks:str,assignmentId:str,failed:{type:'boolean'}},['task','summary','commits','checks']),
    object({action:{const:'acknowledge'},id:str,task:str,assignmentId:str,revision:{type:'integer'}},['action','id','task','assignmentId']),
    object({action:{const:'progress'},id:str,task:str,assignmentId:str,sequence:{type:'integer',minimum:1},step:str,completed:str,checks:str,next:str,blocker:str,revision:{type:'integer'}},['action','id','task','assignmentId','sequence','step','completed','checks','next']),
    variant('checkpoint',{task:str,alertId:str,response:str}),
    variant('request_changes',{task:str,evidence:str}),
    variant('replace',{task:str,evidence:str,tasks:{type:'array',minItems:1,items:task}}),
    variant('cancel',{task:str,evidence:str}),
    variant('review',{task:str,accept:{type:'boolean'},evidence:str,scopeException:str},['task','accept','evidence']),
    variant('takeover',{task:str,evidence:str,complete:{type:'boolean'}},['task','evidence']),
    variant('finish',{pr:str,summary:str,checks:str}),
  ]}},
];
export async function callTeam(name,args,io={}) {
  const env=io.env??process.env;
  const root=env.AGENT_OFFICE_HOOK_URL,id=env.AGENT_OFFICE_WORKER_ID,token=env.AGENT_OFFICE_HOOK_TOKEN;
  if(!root||!id||!token) throw Error('Run team tools inside a hired participant environment');
  const url=new URL('/office/team',root);url.searchParams.set('worker',id);
  if(name==='team_state')for(const key of ['view','task','offset'])if(args[key]!==undefined)url.searchParams.set(key,String(args[key]));
  const res=await (io.fetch??fetch)(url.href,{method:name==='team_state'?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(name==='team_action'?{body:JSON.stringify(args)}:{}),signal:AbortSignal.timeout(90000)});
  const value=await res.json();if(!res.ok)throw Error(value.error??`Team API returned ${res.status}`);
  if(value.contractVersion!==1)throw Error('Update the floor host and office for compact team tools (contract version 1)');
  return {text:JSON.stringify(value,null,2)};
}
