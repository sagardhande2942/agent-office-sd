import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TeamCoordinator, type TeamAdapter } from '../src/server/master-workers/coordinator.js';
import { TeamPresets, config } from '../src/server/master-workers/storage.js';
import type { TeamAction, TeamRequest } from '../src/shared/master-workers.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { main } from '../bin/office-team.js';
const master={provider:'claude',model:'opus'} as const,cheap={provider:'claude',model:'haiku'} as const,other={provider:'codex',model:'gpt-5.4-mini'} as const;
const request:TeamRequest={master,models:[cheap,other],maxWorkers:5,brief:'Build and verify a complete feature',requirements:['Implement the feature','Verify integration']};
const task=(id='one',dependencies:string[]=[])=>({id,title:`Task ${id}`,instructions:'Implement the scoped task in your own checkout',acceptance:'Tests pass and behavior works',files:[`src/${id}.ts`],dependencies});
function fixture(maxWorkers=5) {
 const dir=mkdtempSync(path.join(tmpdir(),'office-team-')),file=path.join(dir,'activity.json'),presets=new TeamPresets(path.join(dir,'presets.json'));
 const workers:WorkerInfo[]=[],messages:string[]=[],stopped:string[]=[],integrated=new Set<string>();let next=0,verified=0;
 const io:TeamAdapter={list:()=>workers,spawn:(a,prompt,_owner,base,role)=>{const id=`w${++next}`;const w={id,provider:a.provider,model:a.model,effort:a.effort,status:'working',prompt,masterWorkers:role,worktree:{path:id,branch:`office/${id}`,base:base?.commit??'a'.repeat(40)}} as WorkerInfo;workers.push(w);return w;},prompt:(id,p)=>{messages.push(p);workers.find(w=>w.id===id)!.status='working';return undefined;},stop:id=>{stopped.push(id);workers.splice(workers.findIndex(w=>w.id===id),1);},head:()=> 'a'.repeat(40),commits:(_id,_base,cs)=>cs,contains:(_id,cs)=>cs.every(c=>integrated.has(c)),prepare:()=>true,verifyPr:async()=>{verified++;},changed:()=>{}};
 let s=new TeamCoordinator(file,presets,io);s.start({...request,maxWorkers});
 const action=(actor:string,b:Record<string,unknown>)=>{const r=s.state().current!;return s.action(actor,{id:r.id,revision:r.revision,...b} as TeamAction);};
 const plan=()=>action(s.state().current!.masterId!,{action:'plan',plan:'Split independent code and integration work, then verify and create one PR',tasks:[task(),task('two',['one'])]});
 return {dir,file,presets,workers,messages,stopped,integrated,action,plan,get s(){return s;},get verified(){return verified;},restart:()=>{s=new TeamCoordinator(file,presets,io);},dispose:()=>rmSync(dir,{recursive:true,force:true})};
}
test('team presets survive edits and runs retain immutable configuration snapshots',()=>{
 const f=fixture();try{
  const p={id:'preset',name:'Economical team',...request};f.presets.edit(p);
  const loaded=new TeamPresets(path.join(f.dir,'presets.json'));assert.equal(loaded.state()[0].name,p.name);
  loaded.edit({...p,name:'Edited',maxWorkers:2});assert.equal(loaded.state()[0].maxWorkers,2);assert.equal(f.s.state().current!.maxWorkers,5);
  loaded.edit({...p,id:'copy',name:'Copy'});loaded.edit(undefined,'preset');assert.deepEqual(loaded.state().map(p=>p.id),['copy']);
  assert.throws(()=>config({...request,models:[cheap,{provider:'opencode',model:'anthropic/haiku'}]}),/distinct/);
  assert.throws(()=>config({...request,maxWorkers:6}),/1–5/);
 }finally{f.dispose();}
});
test('end-to-end task graph waits for reviewed integration and finishes with one verified PR',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  await assert.rejects(f.action(m,{action:'dispatch',task:'two',choice:cheap,reason:'Routine tests'}),/dependencies/);
  await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped implementation suits this eligible model'});
  const w=f.s.state().current!.tasks[0].attempts[0].workerId;
  await assert.rejects(f.action(w,{action:'plan',plan:'replace',tasks:[task()]}),/Only the master/);
  await assert.rejects(f.action(m,{action:'finish',pr:'https://example.test/pr/1',summary:'done',checks:'passed'}),/Finish every task/);
  await f.action(w,{action:'result',task:'one',summary:'Implementation complete',commits:['b'.repeat(40)],checks:'Scoped tests passed'});
  await assert.rejects(f.action(m,{action:'review',task:'one',accept:true,evidence:'Reviewed diff and tests'}),/Integrate/);
  f.integrated.add('b'.repeat(40));await f.action(m,{action:'review',task:'one',accept:true,evidence:'Merged commit and reran tests'});
  await f.action(m,{action:'takeover',task:'two',evidence:'Master verifies final integration',complete:true});
  await f.action(m,{action:'finish',pr:'https://example.test/pr/1',summary:'Completed all requirements',checks:'Full validation passed'});
  assert.equal(f.s.state().current!.phase,'done');assert.equal(f.verified,1);
  await assert.rejects(f.action(m,{action:'finish',pr:'https://example.test/pr/2',summary:'again',checks:'passed'}),/Team is done/);assert.equal(f.verified,1);
 }finally{f.dispose();}
});
test('one retry requires a different eligible model, then master takes over',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  await assert.rejects(f.action(m,{action:'dispatch',task:'one',choice:{provider:'claude',model:'sonnet'},reason:'not allowed'}),/approved pool/);
  await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'First attempt'});
  let w=f.s.state().current!.tasks[0].attempts.at(-1)!.workerId;
  await f.action(w,{action:'result',task:'one',summary:'Tests fail',commits:[],checks:'Failure evidence',failed:true});
  await assert.rejects(f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'again'}),/different eligible model/);
  await f.action(m,{action:'dispatch',task:'one',choice:other,reason:'Different eligible model for recovery'});
  w=f.s.state().current!.tasks[0].attempts.at(-1)!.workerId;
  await f.action(w,{action:'result',task:'one',summary:'Still blocked',commits:[],checks:'Failure evidence',failed:true});
  await assert.rejects(f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'third'}),/Retry requires/);
  await f.action(m,{action:'takeover',task:'one',evidence:'Master will finish after two attempts'});
  assert.equal(f.s.state().current!.tasks[0].status,'takeover');assert.equal(f.s.state().current!.tasks[0].attempts.length,2);
 }finally{f.dispose();}
});
test('configured worker limit holds, idle workers retire without deleting work, and stale actions cannot hire twice',async()=>{
 const f=fixture(1);try{
  const m=f.s.state().current!.masterId!;await f.plan();
  await f.action(m,{action:'plan',plan:'Independent tasks',tasks:[task(),task('two')]});
  const before=f.s.state().current!;
  await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped work'});
  await assert.rejects(f.s.action(m,{action:'dispatch',id:before.id,revision:before.revision,task:'one',choice:cheap,reason:'repeated'}),/Stale/);
  await assert.rejects(f.action(m,{action:'dispatch',task:'two',choice:other,reason:'Parallel task'}),/worker limit/);
  const w=f.s.state().current!.tasks[0].attempts[0].workerId;
  await f.action(w,{action:'result',task:'one',summary:'Failed',commits:[],checks:'Failure',failed:true});f.workers.find(v=>v.id===w)!.status='done';
  await f.action(m,{action:'dispatch',task:'one',choice:other,reason:'Alternate model retry'});
  assert.deepEqual(f.stopped,[w]);assert.equal(f.workers.length,2);assert.equal(f.s.state().current!.workers.length,2,'retain participant history');
 }finally{f.dispose();}
});
test('results wait for an idle master; pause accepts in-flight results; restart reconciles without replay',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped'});
  const w=f.s.state().current!.tasks[0].attempts[0].workerId;
  f.s.control('pause');await f.action(w,{action:'result',task:'one',summary:'Done while paused',commits:[],checks:'Passed'});
  await f.s.tick();assert.equal(f.messages.length,0);
  f.s.control('resume');await f.s.tick();assert.equal(f.messages.length,0,'busy master is not interrupted');
  f.workers.find(v=>v.id===m)!.status='done';await f.s.tick();assert.equal(f.messages.length,1);await f.s.tick();assert.equal(f.messages.length,1);
  f.restart();assert.equal(f.s.state().current!.phase,'paused');assert.equal(f.s.state().current!.tasks[0].status,'review');
  f.s.control('resume');assert.equal(f.workers.length,2,'restart did not hire duplicates');
  f.s.control('stop');assert.equal(f.s.state().current!.phase,'stopped');assert.equal(f.stopped.length,2);
 }finally{f.dispose();}
});
test('task cycles, stolen results and malformed saved state are rejected',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;
  await assert.rejects(f.action(m,{action:'plan',plan:'Cyclic',tasks:[task('one',['two']),task('two',['one'])]}),/Cyclic/);
  await f.plan();await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped'});
  await assert.rejects(f.action(m,{action:'result',task:'one',summary:'Stolen',commits:[],checks:'No'}),/No running assignment/);
  const original=readFileSync(f.file,'utf8');writeFileSync(f.file,'{broken');f.restart();assert.match(f.s.error!,/Cannot read/);assert.throws(()=>f.s.start(request),/Cannot read/);assert.equal(readFileSync(f.file,'utf8'),'{broken');writeFileSync(f.file,original);
 }finally{f.dispose();}
});
test('master can cancel a blocked assignment, preserving its attempt and moving to alternate recovery',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped'});
  const w=f.s.state().current!.tasks[0].attempts[0].workerId;f.workers.find(v=>v.id===w)!.status='needs_input';
  await f.s.tick();assert.match(f.s.state().current!.notifications[m],/needs input/);
  await f.action(m,{action:'cancel',task:'one',evidence:'Worker blocked; preserve partial checkout and use another model'});
  assert.deepEqual(f.stopped,[w]);assert.equal(f.s.state().current!.tasks[0].attempts[0].status,'failed');
  await f.action(m,{action:'dispatch',task:'one',choice:other,reason:'Alternate model recovery'});
  assert.equal(f.s.state().current!.tasks[0].attempts.length,2);
 }finally{f.dispose();}
});
test('CLI bridge uses inherited authentication and propagates API errors without exposing credentials',async()=>{
 const output:string[]=[],errors:string[]=[];let body='';
 const io={env:{AGENT_OFFICE_HOOK_URL:'http://127.0.0.1:1234',AGENT_OFFICE_WORKER_ID:'worker',AGENT_OFFICE_HOOK_TOKEN:'secret'},out:(v:string)=>output.push(v),err:(v:string)=>errors.push(v),read:async()=>'{"action":"finish"}',fetch:async(url:string,opts:any)=>{assert.match(url,/office\/team\?worker=worker/);assert.equal(opts.headers.authorization,'Bearer secret');body=opts.body;return new Response(JSON.stringify({error:'Only the master'}),{status:403});}};
 assert.equal(await main(['--help'],io),0);assert.match(output[0],/team_action/);
 assert.equal(await main(['action'],io),1);assert.equal(body,'{"action":"finish"}');assert.deepEqual(errors,['Only the master']);assert.ok(!errors.join().includes('secret'));
});
