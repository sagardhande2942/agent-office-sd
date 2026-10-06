import test from 'node:test';
import assert from 'node:assert/strict';
import {planProviders} from '../src/shared/plan-providers.js';
import {readPlanRequest} from '../src/server/plan-review-validation.js';
import {planningSeat, planningPrompt, promotePlanWorker} from '../src/server/workers/plan-review.js';
import {PLAN_REVIEW_SEATS} from '../src/shared/layout.js';
import {main} from '../bin/office-plan.js';
import {request, plan} from './fixtures/plan-review.js';

const models = {claude:'sonnet',opencode:'anthropic/haiku',codex:'gpt-5',grok:'grok-code',muse:'muse-spark',dsh:'deepseek',pi:'openai/gpt-5',cursor:'gpt-5'} as const;
const env = {AGENT_OFFICE_WORKER_ID:'worker',AGENT_OFFICE_HOOK_TOKEN:'test-token',AGENT_OFFICE_HOOK_URL:'http://127.0.0.1:1234',AGENT_OFFICE_PLAN_ROLE:'candidate'};

test('every selectable coding provider can be a candidate and reviewer without conflating local model IDs', () => {
  assert.deepEqual(planProviders(), Object.keys(models));
  for (const [provider,model] of Object.entries(models)) {
    const choice={provider,model};
    assert.equal(readPlanRequest({...request,candidates:[choice],reviewer:choice}).candidates[0].provider,provider);
    const info={provider:provider as keyof typeof models,planReview:{id:'activity',role:'candidate' as const,locked:true}};
    if(provider!=='opencode') assert.equal(planningSeat(PLAN_REVIEW_SEATS[0],info.planReview,'agent',true,info.provider,model,'mcp','unused'),undefined);
    const prompt=planningPrompt(info,'Plan the task')!;
    assert.equal(prompt.includes('office-plan.js'),!['claude','opencode','codex'].includes(provider));
    assert.equal(planningPrompt({...info,planReview:{...info.planReview,locked:false}},'Implement'),'Implement');
  }
  assert.equal(readPlanRequest({...request,candidates:[{provider:'codex',model:'gpt-5'},{provider:'cursor',model:'gpt-5'}]}).candidates.length,2);
  assert.throws(()=>readPlanRequest({...request,candidates:[{provider:'claude',model:'sonnet'},{provider:'opencode',model:'anthropic/sonnet'}]}),/aliases/);
  assert.throws(()=>readPlanRequest({...request,reviewer:{provider:'custom'}}),/selectable models/);
  assert.throws(()=>readPlanRequest({...request,reviewer:{provider:'pi'}}),/explicit model/);
});

test('plan CLI bridge reads state and submits JSON through authenticated role-scoped endpoints', async () => {
  const calls:{url:string;options:RequestInit}[]=[],output:string[]=[];
  const fakeFetch=async(url:string,options:RequestInit)=>{calls.push({url,options});return new Response(JSON.stringify({id:'activity'}),{status:200});};
  const io={env,fetch:fakeFetch,out:(s:string)=>output.push(s),err:(s:string)=>assert.fail(s),read:async()=>JSON.stringify({id:'activity',planRevision:0,plan})};
  assert.equal(await main(['plan_review_state'],io),0);
  assert.equal(calls[0].options.method,'GET');
  assert.match(calls[0].url,/\/office\/workers\/plan-review\?worker=worker$/);
  assert.equal((calls[0].options.headers as Record<string,string>).authorization,'Bearer test-token');
  assert.equal(await main(['submit_candidate_plan'],io),0);
  assert.equal(calls[1].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body as string).plan,plan);
  assert.match(output[0],/activity/);
});

test('plan CLI bridge rejects cross-role tools, unlocked callers, malformed/oversized input and server refusals', async () => {
  let requests=0;const errors:string[]=[];
  const io={env,fetch:async()=>{requests++;return new Response(JSON.stringify({error:'refused'}),{status:403});},out:()=>{},err:(s:string)=>errors.push(s),read:async()=>'{bad'};
  assert.equal(await main(['submit_plan_review'],io),1);
  assert.equal(await main(['submit_candidate_plan'],{...io,env:{...env,AGENT_OFFICE_PLAN_ROLE:'reviewer'}}),1);
  assert.equal(await main(['plan_review_state'],{...io,env:{...env,AGENT_OFFICE_PLAN_ROLE:''}}),1);
  assert.equal(await main(['submit_candidate_plan'],io),1);
  assert.equal(await main(['submit_candidate_plan'],{...io,read:async()=>' '.repeat(100001)}),1);
  assert.equal(requests,0);
  assert.equal(await main(['plan_review_state'],io),1);
  assert.equal(requests,1);
  assert.match(errors.at(-1)!,/refused/);
  const help:string[]=[];
  assert.equal(await main(['--help'],{...io,out:(s:string)=>help.push(s)}),0);
  assert.deepEqual(JSON.parse(help[0]).map((t:{name:string})=>t.name),['plan_review_state','submit_candidate_plan']);
});

test('ACP winner promotion closes its planning session before launching fresh implementation', () => {
  const events:string[]=[];
  const w:any={info:{id:'winner',status:'idle',sessionId:'planning-session',planReview:{id:'activity',role:'candidate',locked:true}},dsh:{close:()=>events.push('close')},hookToken:'old'};
  const ctx:any={workers:new Map([['winner',w]]),notePrompt:()=>{},persist:()=>events.push('persist')};
  assert.equal(promotePlanWorker(ctx,'winner','activity','Implement',worker=>{
    events.push('launch');assert.equal(worker.dsh,undefined);assert.equal(worker.info.sessionId,undefined);assert.equal(worker.info.planReview!.locked,false);
  }),undefined);
  assert.deepEqual(events,['close','persist','launch']);
  assert.notEqual(w.hookToken,'old');
});
