import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TeamCoordinator, type TeamAdapter } from '../src/server/master-workers/coordinator.js';
import { TeamPresets } from '../src/server/master-workers/storage.js';
import { normalizeLog, recordEvent, REPLAY_COMMITS_LIMIT } from '../src/server/task-replay/index.js';
import type { TeamAction, TeamRequest, TeamRun } from '../src/shared/master-workers.js';
import { REPLAY_EVENT_LIMIT, REPLAY_TEXT_LIMIT } from '../src/shared/task-replay.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const master={provider:'claude',model:'opus'} as const, cheap={provider:'claude',model:'haiku'} as const, other={provider:'codex',model:'gpt-5.4-mini'} as const;
const request: TeamRequest={master,models:[cheap,other],maxWorkers:5,brief:'Build and verify replay evidence',requirements:['Record structured events','Persist across restarts'],constraints:'Master and Workers only'};
const task=(id='one',dependencies:string[]=[])=>({id,title:`Task ${id}`,instructions:`Implement ${id} in scope`,acceptance:`Tests pass for ${id}`,files:[`src/${id}.ts`],dependencies});
const DETAIL_KEYS=['instructions','message','evidence','reviewReason','commits','reportedChecks','verifiedChecks','pr','missing'];

function fixture() {
 const dir=mkdtempSync(path.join(tmpdir(),'office-replay-')),file=path.join(dir,'activity.json'),presets=new TeamPresets(path.join(dir,'presets.json'));
 const workers:WorkerInfo[]=[],messages:string[]=[],stopped:string[]=[],integrated=new Set<string>();let next=0,verified=0;
 const io:TeamAdapter={list:()=>workers,spawn:(a,prompt,_owner,base,role)=>{const id=`w${++next}`;const w={id,provider:a.provider,model:a.model,effort:a.effort,status:'working',prompt,masterWorkers:role,worktree:{path:id,branch:`office/${id}`,base:base?.commit??'a'.repeat(40)}} as WorkerInfo;workers.push(w);return w;},prompt:(id,p)=>{messages.push(p);const w=workers.find(v=>v.id===id);if(w)w.status='working';return undefined;},stop:id=>{stopped.push(id);const i=workers.findIndex(w=>w.id===id);if(i>=0)workers.splice(i,1);},head:()=> 'a'.repeat(40),commits:(_id,_base,cs)=>cs,contains:(_id,cs)=>cs.every(c=>integrated.has(c)),prepare:()=>true,verifyPr:async()=>{verified++;},changed:()=>{}};
 let s=new TeamCoordinator(file,presets,io);s.start({...request});
 const action=(actor:string,b:Record<string,unknown>)=>{const r=s.state().current!;return s.action(actor,{id:r.id,revision:r.revision,...b} as TeamAction);};
 const plan=()=>action(s.state().current!.masterId!,{action:'plan',plan:'Split independent code and integration work, then verify and create one PR',tasks:[task(),task('two',['one'])]});
 return {dir,file,presets,workers,messages,stopped,integrated,action,plan,get s(){return s;},get verified(){return verified;},restart:()=>{s=new TeamCoordinator(file,presets,io);},dispose:()=>rmSync(dir,{recursive:true,force:true})};
}

test('a full activity records a chronological trail with reported and verified evidence kept apart',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped implementation fits this model'});
  const w=f.s.state().current!.tasks[0].attempts[0].workerId;
  await f.action(w,{action:'result',task:'one',summary:'Implemented and tested',commits:['b'.repeat(40)],checks:'Scoped tests passed'});
  f.integrated.add('b'.repeat(40));
  await f.action(m,{action:'review',task:'one',accept:true,evidence:'Reviewed the diff and reran tests'});
  await f.action(m,{action:'takeover',task:'two',evidence:'Master completes the remaining integration',complete:true});
  await f.action(m,{action:'finish',pr:'https://example.test/pr/42',summary:'All requirements delivered',checks:'Full validation passed'});
  const run=f.s.state().current!,events=run.replay!.events;
  assert.equal(run.phase,'done');assert.equal(f.verified,1);
  assert.deepEqual(events.map(e=>e.type),['start','plan','assignment','result','review','integration','review','integration','final-pr']);
  const [start,planEvent,assignment,result,review,integration,takeoverReview,takeoverIntegration,finalPr]=events;
  const ids=new Set(events.map(e=>e.id));assert.equal(ids.size,events.length,'every event has a unique ID');
  for(let i=1;i<events.length;i++)assert.ok(events[i].timestamp>=events[i-1].timestamp,'events stay chronological');
  for(const e of events){assert.equal(e.activityId,run.id);assert.ok(e.summary.length>0);}
  assert.match(start.details.instructions!,/^Brief: Build and verify replay evidence/);
  assert.match(start.details.instructions!,/- Record structured events/);
  assert.match(start.details.instructions!,/- Persist across restarts/);
  assert.match(start.details.instructions!,/Constraints: Master and Workers only/);
  assert.equal(planEvent.details.instructions,'Split independent code and integration work, then verify and create one PR');
  assert.match(planEvent.details.message!,/"id":"one"/);
  assert.ok(planEvent.details.message!.includes('src/two.ts'),'plan carries task file definitions');
  assert.ok(planEvent.details.message!.includes('"dependencies":["one"]'),'plan carries task dependency definitions');
  assert.equal(assignment.participantId,w);assert.equal(assignment.taskId,'one');
  assert.equal(assignment.details.instructions,'Implement one in scope');
  assert.match(assignment.details.message!,/Attempt: 1/);
  assert.match(assignment.details.message!,/Model: anthropic\/haiku/);
  assert.match(assignment.details.message!,/Reason: Scoped implementation fits this model/);
  assert.match(assignment.details.message!,/Acceptance: Tests pass for one/);
  assert.match(assignment.details.message!,/Files: src\/one\.ts/);
  assert.equal(result.participantId,w);assert.equal(result.taskId,'one');
  assert.equal(result.details.evidence,'Implemented and tested');
  assert.equal(result.details.reportedChecks,'Scoped tests passed');
  assert.deepEqual(result.details.commits,['b'.repeat(40)]);
  assert.ok(!('verifiedChecks' in result.details),'worker checks are never labelled verified');
  assert.equal(review.details.reviewReason,'Reviewed the diff and reran tests');
  assert.deepEqual(integration.details.commits,['b'.repeat(40)]);
  assert.match(integration.details.verifiedChecks!,/ancestors of the master branch HEAD via git merge-base/);
  assert.match(takeoverReview.summary,/took over task two/);
  assert.equal(takeoverReview.details.reviewReason,'Master completes the remaining integration');
  assert.deepEqual(takeoverIntegration.details.commits,['a'.repeat(40)]);
  assert.match(takeoverIntegration.details.verifiedChecks!,/clean and on the team integration branch/);
  assert.equal(finalPr.details.pr,'https://example.test/pr/42');
  assert.equal(finalPr.details.evidence,'All requirements delivered');
  assert.equal(finalPr.details.reportedChecks,'Full validation passed');
  assert.match(finalPr.details.verifiedChecks!,/open non-draft PR/);
  assert.match(finalPr.details.verifiedChecks!,/exactly one open PR/);
  assert.notEqual(finalPr.details.reportedChecks,finalPr.details.verifiedChecks);
  for(const e of events){
   for(const key of Object.keys(e.details))assert.ok(DETAIL_KEYS.includes(key),`unexpected detail key ${key}`);
   if(!['integration','final-pr'].includes(e.type))assert.ok(!('verifiedChecks' in e.details),`${e.type} must not claim independent verification`);
   if(!['result','final-pr'].includes(e.type))assert.ok(!('reportedChecks' in e.details),`${e.type} has no checks to report`);
  }
 }finally{f.dispose();}
});

test('blockers, retries, controls and restarts record real transitions without duplicates',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'First attempt'});
  const worker=f.s.state().current!.tasks[0].attempts[0].workerId;
  f.workers.find(v=>v.id===worker)!.status='needs_input';
  await f.s.tick();await f.s.tick();
  let events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='blocker'&&/needs input/.test(e.summary)).length,1,'one blocker per transition, not per tick');
  await f.plan();
  events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='plan').length,1,'an identical plan resubmission is deduplicated');
  f.s.control('pause');f.s.control('pause');f.s.control('resume');
  events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='pause').length,1,'a repeated pause is deduplicated');
  assert.equal(events.filter(e=>e.type==='resume').length,1);
  const before=f.s.state().current!.replay!.events.length;
  f.restart();
  events=f.s.state().current!.replay!.events;
  assert.equal(events.length,before+1,'restarting a running activity records exactly one recovery event');
  assert.equal(events.at(-1)!.type,'pause');
  assert.match(events.at(-1)!.summary,/Recovered after an office restart/);
  assert.match(events.at(-1)!.details.message!,/Office restarted/);
  assert.deepEqual(events.at(-1)!.details.missing,['activity events recorded while the office was down']);
  f.restart();
  assert.equal(f.s.state().current!.replay!.events.length,events.length,'restarting an already paused activity records nothing new');
  f.s.control('resume');
  events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='resume').length,2,'the resume after recovery is a real resume');
  await f.action(m,{action:'cancel',task:'one',evidence:'Worker blocked; switch models'});
  await f.action(m,{action:'dispatch',task:'one',choice:other,reason:'Alternate model retry'});
  events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='blocker'&&/cancelled/.test(e.summary)).length,1);
  assert.equal(events.filter(e=>e.type==='assignment').length,1);
  assert.equal(events.filter(e=>e.type==='retry').length,1);
  const retry=events.find(e=>e.type==='retry')!;
  assert.equal(retry.participantId,f.s.state().current!.tasks[0].attempts.at(-1)!.workerId);
  assert.equal(retry.taskId,'one');
  assert.match(retry.details.message!,/Attempt: 2/);
  assert.match(retry.details.message!,/Model: codex:gpt-5\.4-mini/);
  assert.match(retry.details.message!,/Reason: Alternate model retry/);
  const retryWorker=f.s.state().current!.tasks[0].attempts.at(-1)!.workerId;
  f.workers.find(v=>v.id===retryWorker)!.status='done';
  await f.s.tick();
  events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='blocker'&&/stopped without a result/.test(e.summary)).length,1);
  f.s.control('stop');
  events=f.s.state().current!.replay!.events;
  assert.equal(events.filter(e=>e.type==='stop').length,1);
  assert.equal(f.s.state().current!.phase,'stopped');
  for(let i=1;i<events.length;i++){
   const a=[events[i-1].type,events[i-1].summary,events[i-1].participantId,events[i-1].taskId];
   const b=[events[i].type,events[i].summary,events[i].participantId,events[i].taskId];
   assert.notDeepEqual(b,a,'no adjacent duplicates');
  }
  assert.deepEqual([...new Set(events.map(e=>e.type))].sort(),['assignment','blocker','pause','plan','resume','retry','start','stop']);
 }finally{f.dispose();}
});

test('identical repeated plan and control events dedupe while real repeats survive',()=>{
 const run={id:'dedupe'} as TeamRun;
 const first=recordEvent(run,{type:'plan',summary:'Plan published with 1 task',details:{instructions:'same plan'}});
 const duplicate=recordEvent(run,{type:'plan',summary:'Plan published with 1 task',details:{instructions:'same plan'}});
 assert.ok(first);assert.equal(duplicate,undefined);assert.equal(run.replay!.events.length,1);
 assert.ok(recordEvent(run,{type:'plan',summary:'Plan published with 2 tasks',details:{instructions:'same plan'}}));
 assert.equal(run.replay!.events.length,2,'a changed plan is still recorded');
 assert.ok(recordEvent(run,{type:'resume',summary:'Activity resumed'}));
 assert.equal(recordEvent(run,{type:'resume',summary:'Activity resumed'}),undefined,'an adjacent identical control event is dropped');
 assert.ok(recordEvent(run,{type:'pause',summary:'Activity paused'}));
 assert.ok(recordEvent(run,{type:'resume',summary:'Activity resumed'}));
 assert.ok(recordEvent(run,{type:'pause',summary:'Activity paused'}),'a pause after other events is a real new pause');
});

test('event storage is bounded with explicit drop, truncation and sanitization notices',()=>{
 const run={id:'run-bounds'} as TeamRun;
 for(let i=0;i<REPLAY_EVENT_LIMIT+20;i++){
  recordEvent(run,{type:'blocker',summary:`noise ${i}`,details:{evidence:`evidence ${i} `.repeat(600),commits:Array.from({length:30},(_,c)=>`commit-${i}-${c}`),missing:Array.from({length:12},(_,x)=>`gap ${x}`)}});
 }
 const log=run.replay!;
 assert.equal(log.events.length,REPLAY_EVENT_LIMIT);
 assert.equal(log.dropped,20,'the persisted dropped count is exact');
 const last=log.events.at(-1)!;
 assert.ok(last.details.evidence!.length<=REPLAY_TEXT_LIMIT);
 assert.match(last.details.evidence!,/…\[truncated\]$/);
 assert.equal(last.details.commits!.length,REPLAY_COMMITS_LIMIT);
 assert.ok(last.details.missing!.some(m=>/additional commit IDs omitted/.test(m)));
 assert.ok(last.details.missing!.some(m=>/was truncated/.test(m)));
 assert.equal(last.details.missing!.length,8);
});

test('freeform evidence is sanitized of credentials, environment values and terminal streams',()=>{
 const escape=String.fromCharCode(27);
 const run={id:'run-secrets'} as TeamRun;
 recordEvent(run,{type:'blocker',summary:'blocked on credentials',details:{evidence:[
  'API_KEY=sk-live-0123456789abcdef0123',
  'password: hunter2',
  'Authorization: Bearer abcdef1234567890abcd',
  'ghp_abcdefghijklmnopqrst1234567890',
  'export AWS_SECRET_ACCESS_KEY=wJ9xYZabcdef123',
  'clone https://carol:topsecret@github.com/acme/repo.git',
  'process.env.DATABASE_TOKEN',
  'paid $AWS_SERVICE_KEY to continue',
  `${escape}[31mterminal dump${escape}[0m normal prose`,
  '--token leetsecret',
 ].join('\n')}});
 const evidence=run.replay!.events[0].details.evidence!;
 for(const secret of ['hunter2','sk-live-0123456789abcdef0123','abcdef1234567890abcd','ghp_abcdefghijklmnopqrst1234567890','wJ9xYZabcdef123','topsecret','leetsecret']) assert.ok(!evidence.includes(secret),`leaked ${secret}`);
 assert.ok(!evidence.includes(escape),'terminal control sequences are excluded');
 assert.ok(!evidence.includes('$AWS_SERVICE_KEY'));
 assert.ok(evidence.includes('API_KEY=[redacted]'));
 assert.ok(evidence.includes('AWS_SECRET_ACCESS_KEY=[redacted]'));
 assert.ok(evidence.includes('normal prose'),'ordinary prose survives');
});

test('recorded events survive restarts without duplication and stay with their activity',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  await f.action(m,{action:'dispatch',task:'one',choice:cheap,reason:'Scoped'});
  const w=f.s.state().current!.tasks[0].attempts[0].workerId;
  await f.action(w,{action:'result',task:'one',summary:'Done while running',commits:[],checks:'Passed'});
  const before=structuredClone(f.s.state().current!.replay!.events);
  f.restart();
  const after=f.s.state().current!.replay!.events;
  assert.deepEqual(after.slice(0,before.length),before,'recorded events survive the restart unchanged');
  assert.equal(after.length,before.length+1,'only the recovery event is new');
  assert.equal(after.at(-1)!.type,'pause');
  assert.match(after.at(-1)!.summary,/Recovered/);
  assert.ok(readFileSync(f.file,'utf8').includes('"events"'),'events are persisted in the activity file');
  f.restart();
  assert.equal(f.s.state().current!.replay!.events.length,after.length,'restarting a paused activity records nothing new');
  f.s.control('stop');
  f.s.start({...request,brief:'Second activity'});
  assert.equal(f.s.state().past.length,1);
  const retained=f.s.state().past[0].replay!.events;
  assert.equal(retained.length,after.length+1,'retained activities keep their logs plus the stop');
  assert.equal(retained[0].type,'start');
  assert.equal(retained.at(-1)!.type,'stop');
 }finally{f.dispose();}
});

test('activities older than the replay log are marked historical without invented data',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  const raw=JSON.parse(readFileSync(f.file,'utf8'));
  delete raw.current.replay;raw.current.phase='done';
  writeFileSync(f.file,JSON.stringify(raw));
  f.restart();
  const run=f.s.state().current!;
  assert.deepEqual(run.replay,{events:[],dropped:0,historical:true});
  recordEvent(run,{type:'pause',summary:'Activity paused'});
  assert.equal(run.replay!.historical,true,'history stays explicitly missing after new events');
  assert.equal(run.replay!.events.length,1);
 }finally{f.dispose();}
});

test('damaged saved logs drop invalid events, keep stored timestamps and count every loss',async()=>{
 const f=fixture();try{
  await f.plan();
  const raw=JSON.parse(readFileSync(f.file,'utf8'));
  raw.current.phase='done';
  raw.current.replay={events:[
   null,
   {id:'bad',type:'not-an-event',timestamp:5,summary:'wrong type',details:{}},
   {id:'notime',type:'start',summary:'missing timestamp',details:{}},
   {id:'kept',timestamp:7,type:'start',summary:'kept event',details:{instructions:'old brief'}},
  ],dropped:3};
  writeFileSync(f.file,JSON.stringify(raw));
  f.restart();
  const current=f.s.state().current!,replay=current.replay!;
  assert.equal(replay.events.length,1);
  assert.equal(replay.events[0].id,'kept');
  assert.equal(replay.events[0].timestamp,7,'stored timestamps are kept, never invented');
  assert.equal(replay.events[0].activityId,current.id);
  assert.equal(replay.dropped,6,'three stored losses plus three invalid entries');
  assert.equal(replay.historical,undefined);
  const bulk=normalizeLog({events:Array.from({length:600},(_,i)=>({id:`e${i}`,timestamp:i,type:'start',summary:`e${i}`,details:{}})),dropped:0},'activity');
  assert.equal(bulk.events.length,REPLAY_EVENT_LIMIT);
  assert.equal(bulk.dropped,100,'loading over the bound keeps the newest events and counts the rest');
 }finally{f.dispose();}
});

test('losing the master during a tick records the pause with its reason',async()=>{
 const f=fixture();try{
  const m=f.s.state().current!.masterId!;await f.plan();
  f.workers.find(v=>v.id===m)!.status='offline';
  await f.s.tick();
  const events=f.s.state().current!.replay!.events;
  assert.equal(f.s.state().current!.phase,'paused');
  assert.equal(events.at(-1)!.type,'pause');
  assert.match(events.at(-1)!.details.message!,/Master is unavailable/);
 }finally{f.dispose();}
});
