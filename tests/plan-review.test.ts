import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PlanReviewTable,type PlanningWorkers} from '../src/server/plan-review.js';
import {readPlanRequest,readDetailedPlan,readPlanReview} from '../src/server/plan-review-validation.js';
import type {WorkerInfo} from '../src/shared/protocol.js';
import type {PlanReviewActivity} from '../src/shared/plan-review.js';
import {toolsForRole,handleMcp} from '../bin/office-workers.js';
import {request,plan,verdict} from './fixtures/plan-review.js';
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'office-plan-unit-')),workers:WorkerInfo[]=[],removed:string[]=[],promoted:string[]=[],prompts:string[]=[];let fail=false;
 const adapter:PlanningWorkers={list:()=>workers,seat:(desk,choice,prompt,role)=>{const w={id:`w${workers.length+1}`,name:'worker',kind:'agent',deskId:desk,provider:choice.provider,model:choice.model,prompt,planReview:role,status:'idle',acked:true,createdBy:'test',createdAt:1,cols:80,rows:24,viewers:[],viewerIds:[]} as WorkerInfo;workers.push(w);return w;},prompt:(_id,p)=>{prompts.push(p);},resume:()=>undefined,promote:(id)=>{assert.equal(JSON.parse(readFileSync(path.join(dir,'plan-review.json'),'utf8')).current.implementationStarted,true,'implementation intent is saved before launching, so restart cleanup preserves winning work');promoted.push(id);workers.find(w=>w.id===id)!.planReview!.locked=false;},remove:async(id)=>{if(fail)return {error:'locked worktree'};removed.push(id);workers.splice(workers.findIndex(w=>w.id===id),1);return{};},cleanup:async()=>undefined};
 const create=()=>new PlanReviewTable(dir,adapter,{update:()=>{},room:()=>10,paused:()=>undefined,git:()=>true,toast:()=>{}});let table=create();
 return {dir,workers,removed,promoted,prompts,get table(){return table;},fail:()=>{fail=true;},recover:()=>{fail=false;},restart:()=>{table.shutdown();table=create();},dispose:()=>{table.shutdown();rmSync(dir,{recursive:true,force:true});}};
}
const turn=()=>new Promise(r=>setImmediate(r));
test('plan request validates 1–5 distinct models and frozen rubric; detailed plans cover every requirement',()=>{
 assert.equal(readPlanRequest(request).weights.coverage,35);
 for(const patch of [{candidates:[]},{candidates:Array(6).fill(request.candidates[0])},{candidates:[request.candidates[0],request.candidates[0]]},{candidates:[{provider:'unknown',model:'x'}]},{weights:{coverage:36,feasibility:25,detail:20,verification:15,simplicity:5}},{minutes:0}])assert.throws(()=>readPlanRequest({...request,...patch}));
 assert.deepEqual(readDetailedPlan(plan,request.requirements),plan);
 for(const patch of [{design:'do it'},{steps:[plan.steps[0]]},{requirements:[]},{verification:[]}])assert.throws(()=>readDetailedPlan({...plan,...patch},request.requirements));
});
test('role-scoped MCP exposes only plan tools and rejects other calls even before HTTP',async()=>{
 assert.deepEqual(toolsForRole('candidate').map((t:any)=>t.name),['plan_review_state','submit_candidate_plan']);
 assert.deepEqual(toolsForRole('reviewer').map((t:any)=>t.name),['plan_review_state','request_plan_clarification','submit_plan_review']);
 const calls:any[]=[];const io={env:{AGENT_OFFICE_PLAN_ROLE:'candidate',AGENT_OFFICE_HOOK_URL:'http://127.0.0.1:1',AGENT_OFFICE_WORKER_ID:'a',AGENT_OFFICE_HOOK_TOKEN:'test'},fetch:async(url:any)=>{calls.push(url);return Response.json({phase:'planning'});}};
 const bad=await handleMcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'send_home',arguments:{workers:['x']}}},io);assert.ok(bad.error);assert.equal(calls.length,0);
 const good=await handleMcp({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'plan_review_state',arguments:{}}},io);assert.ok(good.result);assert.match(calls[0],/\/plan-review\?worker=a/);
});
test('blind plans, fixed ranking, persistence-before-cleanup and winner-only implementation',async()=>{
 const f=fixture();try{
  assert.equal(f.table.start(request,'test'),undefined);const [a,b,reviewer]=f.workers;
  assert.throws(()=>f.table.submitPlan(reviewer,{id:f.table.state().current!.id,planRevision:0,plan}),/role/);
  const id=f.table.state().current!.id;f.table.submitPlan(a,{id,planRevision:0,plan});assert.equal((f.table.view(b) as any).plan,null);
  assert.throws(()=>f.table.submitPlan(a,{id,planRevision:0,plan:{...plan,design:plan.design+' changed'}}),/frozen/);
  f.table.submitPlan(b,{id,planRevision:0,plan});await turn();const m=f.table.state().current!;assert.equal(m.phase,'reviewing');
  const blind=JSON.stringify(f.table.view(reviewer));assert.ok(!blind.includes('sonnet'));assert.ok(!blind.includes('workerId'));
  assert.throws(()=>f.table.submitReview(reviewer,verdict(m,[8,6],'B')),/Scores select A/);assert.equal(f.removed.length,0);assert.equal(f.promoted.length,0);
  f.table.submitReview(reviewer,verdict(m));await turn();await turn();
  assert.deepEqual(f.removed,[b.id]);assert.deepEqual(f.promoted,[a.id]);assert.equal(f.table.state().current!.phase,'implementing');
  const saved=JSON.parse(readFileSync(path.join(f.dir,'plan-reviews',id,'activity.json'),'utf8'));assert.equal(saved.review.winner,'A');assert.match(readFileSync(path.join(f.dir,'plan-reviews',id,'review.md'),'utf8'),/Candidate B: reject/);
  f.restart();assert.equal(f.table.state().current!.phase,'implementing');assert.deepEqual(f.promoted,[a.id]);
 }finally{f.dispose();}
});
test('cleanup failure blocks implementation; retry completes cleanup without touching outsider',async()=>{
 const f=fixture();try{f.table.start(request,'test');const [a,b,r]=f.workers;const id=f.table.state().current!.id;f.table.submitPlan(a,{id,planRevision:0,plan});f.table.submitPlan(b,{id,planRevision:0,plan});await turn();f.workers.push({...a,id:'outsider',deskId:'desk-1',planReview:undefined});f.fail();f.table.submitReview(r,verdict(f.table.state().current!));await turn();assert.equal(f.table.state().current!.phase,'cleanup');assert.match(f.table.state().current!.error!,/locked/);assert.equal(f.promoted.length,0);f.restart();assert.equal(f.table.state().current!.phase,'cleanup');f.recover();assert.equal(await f.table.retryCleanup(),undefined);assert.ok(f.workers.find(w=>w.id==='outsider'));assert.deepEqual(f.removed,[b.id]);assert.deepEqual(f.promoted,[a.id]);}finally{f.dispose();}
});
test('one clarification round freezes original plan and requires a complete revision',async()=>{
 const f=fixture();try{f.table.start(request,'test');const [a,b,r]=f.workers,id=f.table.state().current!.id;f.table.submitPlan(a,{id,planRevision:0,plan});f.table.submitPlan(b,{id,planRevision:0,plan});await turn();f.table.clarify(r,{id,revision:f.table.state().current!.revision,requests:[{candidate:'A',question:'Please explain how the existing router preserves authentication for the users endpoint.'}]});assert.equal(f.table.state().current!.phase,'planning');assert.throws(()=>f.table.submitPlan(a,{id,planRevision:0,plan}),/revision/);f.table.submitPlan(a,{id,planRevision:1,plan:{...plan,design:plan.design+' Authentication is retained.'}});await turn();assert.ok(f.table.state().current!.candidates[0].previousPlan);assert.throws(()=>f.table.clarify(r,{id,revision:f.table.state().current!.revision,requests:[]}),/One clarification/);}finally{f.dispose();}
});
test('eligibility gates outrank raw scores and stable ties follow coverage then feasibility then label',()=>{
 const f=fixture();try{f.table.start(request,'test');const m=f.table.state().current!;for(const c of m.candidates)c.plan=plan;
 const tie=verdict(m,[8,8]);assert.equal(readPlanReview(tie,m).winner,'A');
 const gated=verdict(m,[9,8],'B');gated.ratings[0].gates.detail.pass=false;assert.equal(readPlanReview(gated,m).winner,'B');
 const none=verdict(m,[8,8],null);for(const r of none.ratings)r.gates.detail.pass=false;assert.equal(readPlanReview(none,m).winner,null);
 m.candidates[1].plan=undefined;assert.throws(()=>readPlanReview(verdict(m),m),/missing plan/);
 }finally{f.dispose();}
});

test('corrupt saved state blocks a new activity instead of overwriting history',()=>{
 const f=fixture();try{writeFileSync(path.join(f.dir,'plan-review.json'),'{broken');f.restart();assert.match(f.table.state().error!,/could not be restored/);assert.match(f.table.start(request,'test')!,/Recover/);assert.equal(readFileSync(path.join(f.dir,'plan-review.json'),'utf8'),'{broken');}finally{f.dispose();}
});
test('five distinct candidates plus one reviewer use six separate seats',()=>{
 const f=fixture();try{const choices=['a','b','c','d','e'].map(model=>({provider:'opencode',model:'provider/'+model}));assert.equal(f.table.start({...request,candidates:choices},'test'),undefined);assert.equal(f.workers.length,6);assert.equal(new Set(f.workers.map(w=>w.deskId)).size,6);assert.equal(f.workers.filter(w=>w.planReview?.role==='reviewer').length,1);}finally{f.dispose();}
});

test('no eligible plan cleans all candidates and starts no implementation',async()=>{
 const f=fixture();try{f.table.start(request,'test');const [a,b,r]=f.workers,id=f.table.state().current!.id;f.table.submitPlan(a,{id,planRevision:0,plan});f.table.submitPlan(b,{id,planRevision:0,plan});await turn();const review=verdict(f.table.state().current!,[8,8],null);for(const rating of review.ratings)rating.gates.detail.pass=false;f.table.submitReview(r,review);await turn();await turn();assert.equal(f.table.state().current!.phase,'no-winner');assert.deepEqual(f.removed,[a.id,b.id]);assert.equal(f.promoted.length,0);f.restart();assert.equal(f.table.state().current!.review!.winner,null);}finally{f.dispose();}
});
test('planning deadline includes missing plans; reviewer timeout cleans without implementing',async()=>{
 const f=fixture();try{f.table.start(request,'test');let state=f.table.state();state.current!.deadline=Date.now()-1000;writeFileSync(path.join(f.dir,'plan-review.json'),JSON.stringify(state));f.restart();await (f.table as any).tick();assert.equal(f.table.state().current!.phase,'reviewing');state=f.table.state();state.current!.reviewDeadline=Date.now()-1000;writeFileSync(path.join(f.dir,'plan-review.json'),JSON.stringify(state));f.restart();await (f.table as any).tick();assert.equal(f.table.state().current!.phase,'error');assert.equal(f.workers.length,0);assert.equal(f.promoted.length,0);}finally{f.dispose();}
});
