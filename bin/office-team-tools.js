// Team tools share the existing authenticated worker transport, with server-enforced roles.
const str={type:'string',minLength:1};
const strings={type:'array',items:str};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const choice=object({provider:str,model:str,effort:str},['provider','model']);
const base={id:str,revision:{type:'integer',minimum:0}};
const variant=(action,properties,required=Object.keys(properties))=>object({...base,action:{const:action},...properties},['id','revision','action',...required]);
export const TEAM_TOOLS=[
  {name:'team_state',description:'Read your Master / Workers activity, revision, task assignments, results and approved model pool. Only participants may call it.',inputSchema:object({}),annotations:{readOnlyHint:true}},
  {name:'team_action',description:'Operate on your team using its current id/revision. Master: publish plan, dispatch to an eligible model (one alternate-model retry), review after merging worker commits preserving ancestry, take over tasks, finish after verified open PR and checklist. Worker: submit result, including failures. Read state after stale-revision errors. CLI: office-team.js --help.',inputSchema:{type:'object',oneOf:[
    variant('plan',{plan:str,tasks:{type:'array',minItems:1,items:object({id:str,title:str,instructions:str,acceptance:str,files:strings,dependencies:strings})}}),
    variant('dispatch',{task:str,choice,reason:str}),
    variant('result',{task:str,summary:str,commits:strings,checks:str,failed:{type:'boolean'}},['task','summary','commits','checks']),
    variant('cancel',{task:str,evidence:str}),
    variant('review',{task:str,accept:{type:'boolean'},evidence:str}),
    variant('takeover',{task:str,evidence:str,complete:{type:'boolean'}},['task','evidence']),
    variant('finish',{pr:str,summary:str,checks:str}),
  ]}},
];
export async function callTeam(name,args,io={}) {
  const env=io.env??process.env;
  const root=env.AGENT_OFFICE_HOOK_URL,id=env.AGENT_OFFICE_WORKER_ID,token=env.AGENT_OFFICE_HOOK_TOKEN;
  if(!root||!id||!token) throw Error('Run team tools inside a hired participant environment');
  const url=new URL('/office/team',root);url.searchParams.set('worker',id);
  const res=await (io.fetch??fetch)(url.href,{method:name==='team_state'?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(name==='team_action'?{body:JSON.stringify(args)}:{}),signal:AbortSignal.timeout(90000)});
  const value=await res.json();if(!res.ok)throw Error(value.error??`Team API returned ${res.status}`);
  return {text:JSON.stringify(value,null,2)};
}
