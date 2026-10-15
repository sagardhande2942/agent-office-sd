import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TeamCoordinator, type TeamAdapter } from '../src/server/master-workers/coordinator.js';
import { TeamPresets } from '../src/server/master-workers/storage.js';
import { agentView, actionReceipt } from '../src/server/master-workers/agent-view.js';
import { fixturePlan } from './support/team-contract.js';
import type { TeamAction, TeamTaskDefinition } from '../src/shared/master-workers.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
const cheap={provider:'claude',model:'haiku'} as const,other={provider:'codex',model:'gpt-5.4-mini'} as const;
const task=(id='one',files=[`src/${id}.ts`],dependencies:string[]=[]):TeamTaskDefinition=>fixturePlan({action:'plan',tasks:[{id,title:id,instructions:'Implement the agreed outcome using existing patterns',acceptance:'Preserve authorization and handle empty responses',files,dependencies}]}).tasks[0];
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'team-contract-')),file=path.join(dir,'activity.json');
 const workers:WorkerInfo[]=[],messages:{id:string;prompt:string}[]=[];let now=1000000,next=0,changed:string[]=[],observeFails=false,promptError:string|undefined;
 const io:TeamAdapter={now:()=>now,list:()=>workers,spawn:(choice,prompt,_owner,_base,role)=>{const w={id:`w${++next}`,status:'working',provider:choice.provider,model:choice.model,prompt,masterWorkers:role,worktree:{path:`w${next}`,branch:`office/w${next}`}} as WorkerInfo;workers.push(w);return w;},prompt:(id,prompt)=>{if(promptError)return promptError;messages.push({id,prompt});workers.find(w=>w.id===id)!.status='working';},stop:id=>{workers.find(w=>w.id===id)!.status='offline';},head:()=> 'a'.repeat(40),commits:(_id,_base,cs)=>cs,contains:()=>true,prepare:()=>true,verifyPr:async()=>{},changedPaths:()=>changed,observe:async()=>{if(observeFails)throw Error('git unavailable');return {at:now,head:'a'.repeat(40),paths:changed,additions:1,deletions:0};},changed:()=>{}};
 let s=new TeamCoordinator(file,new TeamPresets(path.join(dir,'presets.json')),io);
 s.start({master:{provider:'claude',model:'opus'},models:[cheap,other],maxWorkers:5,brief:'Implement a bounded outcome',requirements:['Keep quality gates']});
 const master=()=>s.state().current!.masterId!;
 const act=(actor:string,b:object)=>{const r=s.state().current!;return s.action(actor,{id:r.id,revision:r.revision,...b} as TeamAction);};
 const plan=(tasks=[task()])=>act(master(),{action:'plan',plan:'Detailed full architecture decisions',designSummary:'Use existing interfaces and keep authorization intact',tasks});
 const dispatch=async(id='one',choice=cheap as typeof cheap|typeof other)=>{await act(master(),{action:'dispatch',task:id,choice,reason:'Bounded implementation with settled design'});return s.state().current!.tasks.find(t=>t.id===id)!.attempts.at(-1)!;};
 const acknowledge=(id='one')=>{const a=s.state().current!.tasks.find(t=>t.id===id)!.attempts.at(-1)!;return act(a.workerId,{action:'acknowledge',task:id,assignmentId:a.assignmentId});};
 const progress=(extra:object={})=>{const a=s.state().current!.tasks[0].attempts.at(-1)!;return act(a.workerId,{action:'progress',task:'one',assignmentId:a.assignmentId,sequence:1,step:'Implementing handler',completed:'Read existing interfaces',checks:'No checks yet',next:'Add empty-state behavior',...extra});};
 const result=async(id='one')=>{const a=s.state().current!.tasks.find(t=>t.id===id)!.attempts.at(-1)!;await acknowledge(id);return act(a.workerId,{action:'result',task:id,assignmentId:a.assignmentId,summary:'Implemented agreed behavior',checks:'npm run typecheck passed at '+ 'a'.repeat(40),commits:['a'.repeat(40)]});};
 return {dir,file,workers,messages,master,act,plan,dispatch,acknowledge,progress,result,get s(){return s;},advance:(ms:number)=>{now+=ms;},setPaths:(v:string[])=>{changed=v;},failObserve:()=>{observeFails=true;},setPromptError:(value?:string)=>{promptError=value;},restart:()=>{s=new TeamCoordinator(file,new TeamPresets(path.join(dir,'presets.json')),io);},close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('agent views are compact, role-specific, detailed on demand and receipts do not repeat history',async()=>{
 const f=fixture();try{await f.plan([task(),task('two')]);const a=await f.dispatch();
 const raw=f.s.state();raw.past=[structuredClone(raw.current!)];raw.current!.plan='Long architecture '.repeat(1000);
 const summary=agentView(raw,f.master()) as any;assert.equal(summary.past,undefined);assert.equal(summary.presets,undefined);assert.equal(summary.current.plan,undefined);
 assert.ok(JSON.stringify(summary).length<JSON.stringify(raw).length/4);
 const worker=agentView(raw,a.workerId) as any;assert.equal(worker.assignment.assignmentId,a.assignmentId);assert.equal(worker.assignment.attempts,undefined);assert.equal(worker.current.models,undefined);
 assert.throws(()=>agentView(raw,a.workerId,{view:'task',task:'two'}),/unavailable/);
 assert.throws(()=>agentView(raw,a.workerId,{view:'history'}),/Only the master/);
 assert.throws(()=>agentView(raw,'outsider'),/participant/);
 const detail=agentView(raw,f.master(),{view:'task',task:'one'}) as any;assert.equal(detail.task.specification.steps.length,3);
 const receipt=actionReceipt(raw,'one');assert.equal((receipt.current as any).tasks,undefined);assert.equal(receipt.task!.workerId,a.workerId);
 assert.equal((agentView(raw,f.master(),{view:'history'}) as any).events.length,3);
 }finally{f.close();}
});
test('dispatch requires a detailed contract and rejects overlapping or unsafe write scope',async()=>{
 const f=fixture();try{const missing={...task(),specification:undefined};await f.plan([missing]);await assert.rejects(f.dispatch(),/specification/);
 await assert.rejects(f.plan([task('bad',['../escape'])]),/repository-relative/);
 await f.plan([task('one',['src/']),task('two',['src/users.ts'])]);await f.dispatch();await assert.rejects(f.dispatch('two'),/overlaps/);
 }finally{f.close();}
});
test('acknowledgment and progress are assignment-scoped, idempotent and do not advance orchestration revision',async()=>{
 const f=fixture();try{await f.plan();const a=await f.dispatch(),r=f.s.state().current!;
 await assert.rejects(f.progress(),/Acknowledge/);
 await f.acknowledge();await f.acknowledge();await f.progress();const events=f.s.state().current!.replay!.events.length;await f.progress();assert.equal(f.s.state().current!.replay!.events.length,events);
 assert.equal(f.s.state().current!.revision,r.revision);
 await assert.rejects(f.progress({assignmentId:'old'}),/current assignment/);await assert.rejects(f.progress({completed:'Conflicting report'}),/conflicting/);
 await assert.rejects(f.act(f.master(),{action:'acknowledge',task:'one',assignmentId:a.assignmentId}),/current assignment/);
 // Master can use the revision captured before concurrent progress.
 await f.s.action(f.master(),{action:'plan',id:r.id,revision:r.revision,plan:r.plan!,designSummary:r.designSummary,tasks:r.tasks});
 }finally{f.close();}
});
test('healthy monitoring has no master wakeups; overdue alerts deduplicate and observations do not prove progress',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.acknowledge();await f.progress();const revision=f.s.state().current!.revision;
 await f.s.tick();assert.equal(f.messages.length,0);assert.equal(f.s.state().current!.revision,revision);
 f.advance(240001);await f.s.tick();await f.s.tick();let a=f.s.state().current!.tasks[0].attempts[0];assert.equal(a.alerts!.length,1);assert.equal(f.messages.length,0);assert.ok(a.observation);
 f.workers.find(w=>w.id===f.master())!.status='idle';await f.s.tick();assert.equal(f.messages.length,1);assert.ok(f.s.state().current!.tasks[0].attempts[0].alerts![0].deliveredAt);
 await f.progress({sequence:2});a=f.s.state().current!.tasks[0].attempts[0];assert.ok(a.alerts![0].clearedAt);assert.equal(f.messages.length,1);
 f.advance(240001);await f.s.tick();a=f.s.state().current!.tasks[0].attempts[0];assert.equal(a.alerts!.length,2);
 await f.act(f.master(),{action:'checkpoint',task:'one',alertId:a.alerts![1].id,response:'Continue: scoped integration test is running; inspect its result next'});
 assert.match(f.s.state().current!.tasks[0].attempts[0].alerts![1].response!,/Continue/);
 }finally{f.close();}
});
test('blockers alert immediately; observation failure and long estimates do not stop assignments',async()=>{
 const f=fixture();try{const t=task();t.specification!.expectedMinutes=20;await f.plan([t]);await f.dispatch();await f.acknowledge();await f.progress({blocker:'Need master decision on response contract'});assert.match(f.s.state().current!.tasks[0].attempts[0].alerts![0].message,/response contract/);
 f.failObserve();f.advance(21*60000);await f.s.tick();const a=f.s.state().current!.tasks[0].attempts[0];assert.equal(a.status,'running');assert.ok(a.observation!.error);assert.ok(a.alerts!.some(v=>v.kind==='estimate'));
 }finally{f.close();}
});
test('pause and restart preserve work and start a fresh report window on resume',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.acknowledge();f.s.control('pause');f.advance(600000);await f.s.tick();assert.equal(f.s.state().current!.tasks[0].attempts[0].alerts,undefined);
 f.restart();assert.equal(f.s.state().current!.phase,'paused');f.s.control('resume');await f.s.tick();assert.equal(f.s.state().current!.tasks[0].attempts[0].alerts,undefined);assert.equal(f.workers.length,2);
 }finally{f.close();}
});
test('one correction preserves evidence, uses the same worker and rejects obsolete reports and results',async()=>{
 const f=fixture();try{await f.plan();const a=await f.dispatch();await f.result();await f.act(f.master(),{action:'request_changes',task:'one',evidence:'Add the missing empty-state case and rerun scoped checks'});
 let current=f.s.state().current!.tasks[0].attempts[0];assert.equal(current.workerId,a.workerId);assert.notEqual(current.assignmentId,a.assignmentId);assert.equal(current.previousResults![0].commits.length,1);
 await assert.rejects(f.progress({assignmentId:a.assignmentId}),/current assignment/);
 await assert.rejects(f.act(a.workerId,{action:'result',task:'one',assignmentId:a.assignmentId,summary:'old',checks:'old',commits:[]}),/current assignmentId/);
 f.workers.find(w=>w.id===a.workerId)!.status='done';await f.s.tick();assert.ok(f.messages.some(v=>v.id===a.workerId&&v.prompt.includes('REVIEW FINDINGS')));
 await f.result();await assert.rejects(f.act(f.master(),{action:'request_changes',task:'one',evidence:'Again'}),/exhausted/);
 await f.act(f.master(),{action:'review',task:'one',accept:true,evidence:'Reviewed actual diff and corrected checks'});assert.equal(f.s.state().current!.tasks[0].status,'done');
 }finally{f.close();}
});
test('scope violations block acceptance until a specific reviewed exception is supplied',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.result();f.setPaths(['src/one.ts','src/other.ts']);await assert.rejects(f.act(f.master(),{action:'review',task:'one',accept:true,evidence:'Reviewed'}),/Out-of-scope/);
 await f.act(f.master(),{action:'review',task:'one',accept:true,evidence:'Inspected both diffs',scopeException:'src/other.ts exports the required shared type; no behavior change'});assert.match(f.s.state().current!.tasks[0].attempts[0].review!,/Scope exception/);
 }finally{f.close();}
});
test('replacement preserves attempts, rewires dependencies and cannot reset recovery spending',async()=>{
 const f=fixture();try{await f.plan([task(),task('dependent',['dependent.ts'],['one'])]);await f.dispatch();await f.act(f.master(),{action:'cancel',task:'one',evidence:'Assignment too broad; retain existing local changes for inspection'});
 await f.act(f.master(),{action:'replace',task:'one',evidence:'Split handler and tests; no partial commits retained',tasks:[task('handler'),task('tests')]});
 let r=f.s.state().current!;assert.deepEqual(r.tasks.find(t=>t.id==='dependent')!.dependencies,['handler','tests']);assert.equal(r.tasks[0].attempts.length,1);assert.equal(r.tasks[0].status,'superseded');
 await f.dispatch('handler');await f.dispatch('tests');await f.act(f.master(),{action:'cancel',task:'handler',evidence:'Still blocked'});
 await assert.rejects(f.dispatch('handler',other),/lineage exhausted/);
 await f.act(f.master(),{action:'takeover',task:'handler',evidence:'Master handles remaining work',complete:true});
 r=f.s.state().current!;assert.equal(r.tasks.find(t=>t.id==='handler')!.status,'done');
 }finally{f.close();}
});
test('legacy active assignments can submit results while unstarted legacy tasks need specifications',async()=>{
 const f=fixture();try{await f.plan();const a=await f.dispatch();const raw=JSON.parse(readFileSync(f.file,'utf8'));delete raw.current.tasks[0].attempts[0].assignmentId;delete raw.current.tasks[0].specification;writeFileSync(f.file,JSON.stringify(raw));f.restart();f.s.control('resume');await f.act(a.workerId,{action:'result',task:'one',summary:'Legacy result',checks:'Existing evidence',commits:[]});assert.equal(f.s.state().current!.tasks[0].status,'review');
 }finally{f.close();}
});
test('replanning unstarted replacements retains the recovery root and cannot remove replacement history',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.act(f.master(),{action:'cancel',task:'one',evidence:'Split oversized assignment'});
 await f.act(f.master(),{action:'replace',task:'one',evidence:'No partial commits retained',tasks:[task('small')]});
 let r=f.s.state().current!;
 await f.act(f.master(),{action:'plan',plan:r.plan,designSummary:r.designSummary,tasks:r.tasks.map(t=>({id:t.id,title:t.title,instructions:t.instructions,acceptance:t.acceptance,files:t.files,dependencies:t.dependencies,specification:t.specification}))});
 assert.equal(f.s.state().current!.tasks[1].recoveryRoot,'one');
 r=f.s.state().current!;await assert.rejects(f.act(f.master(),{action:'plan',plan:r.plan,tasks:[r.tasks[0]]}),/Keep started/);
 }finally{f.close();}
});
test('replacement dependency cycles are rejected atomically',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.act(f.master(),{action:'cancel',task:'one',evidence:'Need smaller assignment'});
 const before=f.s.state().current!;await assert.rejects(f.act(f.master(),{action:'replace',task:'one',evidence:'Split with invalid ordering',tasks:[task('left',['left.ts'],['right']),task('right',['right.ts'],['left'])]}),/Cyclic/);
 assert.deepEqual(f.s.state().current!.tasks,before.tasks);
 }finally{f.close();}
});
test('malformed saved progress is surfaced without overwriting retained work',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.acknowledge();await f.progress();const raw=JSON.parse(readFileSync(f.file,'utf8'));raw.current.tasks[0].attempts[0].progress.sequence=-1;const bad=JSON.stringify(raw);writeFileSync(f.file,bad);f.restart();assert.match(f.s.error!,/progress sequence/);assert.equal(readFileSync(f.file,'utf8'),bad);
 }finally{f.close();}
});
test('assignment design stays stable across replanning while original requirements remain available explicitly',async()=>{
 const f=fixture();try{await f.plan();const a=await f.dispatch(),r=f.s.state().current!;
 await f.act(f.master(),{action:'plan',plan:'Revised approach for future assignments',designSummary:'Future tasks use an additional interface',tasks:r.tasks});
 const worker=agentView(f.s.state(),a.workerId) as any;assert.equal(worker.designSummary,'Use existing interfaces and keep authorization intact');
 const plan=agentView(f.s.state(),f.master(),{view:'plan'}) as any;assert.deepEqual(plan.requirements,['Keep quality gates']);assert.equal(plan.brief,'Implement a bounded outcome');
 }finally{f.close();}
});

test('recovered reporting cancels an undelivered automatic alert without waking the master',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.acknowledge();f.advance(240001);await f.s.tick();assert.equal(f.messages.length,0);
 await f.progress();f.workers.find(w=>w.id===f.master())!.status='idle';await f.s.tick();assert.equal(f.messages.length,0);assert.equal(f.s.state().current!.metrics?.masterNotices??0,0);
 }finally{f.close();}
});
test('clearing an automatic alert preserves queued user instructions and excludes stale alert text',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.acknowledge();await f.progress({blocker:'Need contract decision'});f.s.enqueue('USER DIRECTION: preserve the existing response shape.');
 await f.progress({sequence:2});f.workers.find(w=>w.id===f.master())!.status='idle';await f.s.tick();assert.equal(f.messages.length,1);assert.match(f.messages[0].prompt,/USER DIRECTION/);assert.doesNotMatch(f.messages[0].prompt,/Need contract decision/);
 const alert=f.s.state().current!.tasks[0].attempts[0].alerts![0];assert.ok(alert.clearedAt);assert.equal(alert.deliveredAt,undefined);
 }finally{f.close();}
});

test('failed notice delivery preserves user instructions and retries only unresolved automatic alerts',async()=>{
 const f=fixture();try{await f.plan();await f.dispatch();await f.acknowledge();await f.progress({blocker:'Need retryable contract decision'});f.s.enqueue('USER DIRECTION: maintain authorization.');
 f.setPromptError('Provider is temporarily busy');f.workers.find(w=>w.id===f.master())!.status='idle';await f.s.tick();
 let r=f.s.state().current!;assert.equal(f.messages.length,0);assert.equal(r.tasks[0].attempts[0].alerts![0].deliveredAt,undefined);assert.match(r.notifications[f.master()],/USER DIRECTION/);assert.doesNotMatch(r.notifications[f.master()],/retryable contract/);
 await f.progress({sequence:2});f.setPromptError();await f.s.tick();assert.equal(f.messages.length,1);assert.match(f.messages[0].prompt,/USER DIRECTION/);assert.doesNotMatch(f.messages[0].prompt,/retryable contract/);r=f.s.state().current!;assert.equal(r.metrics!.masterNotices,1);
 }finally{f.close();}
});
