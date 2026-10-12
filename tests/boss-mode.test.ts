import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BossEngine,type BossIO } from '../src/server/boss-mode/engine.js';
import { bossDefaults,validateBossConfig } from '../src/shared/boss-mode/config.js';
import { bossPosition } from '../src/shared/boss-mode/presence.js';
import { TeamCoordinator,type TeamAdapter } from '../src/server/master-workers/coordinator.js';
import { TeamPresets,config as teamConfig } from '../src/server/master-workers/storage.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { BossItem,BossConfig } from '../src/shared/boss-mode/types.js';
import type { TeamAction } from '../src/shared/master-workers.js';
const proposed={title:'Fix draft loss',problem:'Drafts disappear on refresh',evidence:'Reproduced from a failing reload scenario',benefit:'Preserve user work',acceptance:['A draft survives refresh'],category:'fixes' as const,priority:90,dependencies:[]};
function fixture(){
  const dir=mkdtempSync(path.join(os.tmpdir(),'boss-engine-')),file=path.join(dir,'boss.json'),workers:WorkerInfo[]=[],teams=new Map<string,TeamCoordinator>(),messages:string[]=[];
  let now=Date.UTC(2026,9,12,12),next=0,discovered=0,authorization:string|undefined;
  const config:BossConfig={...bossDefaults(),mission:'Keep drafts reliable',checks:['true']};
  const adapter:TeamAdapter={list:()=>workers,spawn:(a,_prompt,_owner,_base,role)=>{const w={id:'w'+(++next),provider:a.provider,model:a.model,effort:a.effort,masterWorkers:role,status:'working',worktree:{path:'work-'+next,branch:'office/'+next}} as WorkerInfo;workers.push(w);return w;},prompt:(id,message)=>{messages.push(message);workers.find(w=>w.id===id)!.status='working';},stop:id=>{const w=workers.find(w=>w.id===id);if(w)w.status='offline';},head:()=> 'a'.repeat(40),commits:(_id,_base,c)=>c,contains:()=>true,prepare:()=>true,verifyPr:async()=>{},changed:()=>{}};
  const io:BossIO={now:()=>now,workers:()=>workers,allowed:()=>authorization,discover:async(_cfg,token)=>{discovered++;const w={id:'discovery-'+(++next),status:'working',masterWorkers:{id:'boss-discovery-'+token,role:'master'}} as WorkerInfo;workers.push(w);return w.id;},stop:async id=>{const w=workers.find(w=>w.id===id);if(w)w.status='offline';},suspend:id=>{const w=workers.find(w=>w.id===id);if(w)w.status='offline';},prompt:(id,message)=>adapter.prompt(id,message),team:(item)=>{let run=teams.get(item.id);if(!run){run=new TeamCoordinator(path.join(dir,item.id+'.json'),new TeamPresets(path.join(dir,'presets.json')),adapter,10);teams.set(item.id,run);}return run;},fetch:async()=>{},openPrs:()=>0,feedback:async()=>{},changed:()=>{}};
  let engine=new BossEngine(file,io);
  const act=async(actor:string,body:Record<string,unknown>)=>{const r=engine.state().team!.current!;return teams.get(engine.state().active!)!.action(actor,{id:r.id,revision:r.revision,...body} as TeamAction);};
  return {dir,file,io,config,workers,messages,teams,get engine(){return engine;},get discovered(){return discovered;},act,advance:(ms:number)=>{now+=ms;},deny:(reason?:string)=>{authorization=reason;},restart:()=>{teams.clear();engine=new BossEngine(file,io);},dispose:()=>rmSync(dir,{recursive:true,force:true})};
}
async function select(f:ReturnType<typeof fixture>){await f.engine.control({action:'configure',config:f.config});await f.engine.control({action:'on'});await f.engine.tick();const s=f.engine.state();await f.engine.worker(s.discovery!.workerId!,{action:'propose',revision:s.revision,items:[proposed],summary:'Reproduced a useful fix'});await f.engine.tick();await f.engine.tick();}
test('configuration supports ten slots, rejects invalid limits, and preserves ordinary team ceiling',()=>{
  for(const count of [1,10])assert.equal(validateBossConfig({...bossDefaults(),maxWorkers:count}).maxWorkers,count);
  for(const count of [0,11,1.5])assert.throws(()=>validateBossConfig({...bossDefaults(),maxWorkers:count}),/maxWorkers/);
  assert.equal(validateBossConfig({...bossDefaults(),workerMode:'slots',models:Array.from({length:10},()=>({provider:'claude'})),maxWorkers:10}).models.length,10);
  assert.throws(()=>validateBossConfig({...bossDefaults(),models:[{provider:'claude'},{provider:'claude'}]}),/duplicate/);
  assert.throws(()=>teamConfig({master:{provider:'claude'},models:[{provider:'claude'}],maxWorkers:10}),/1–5/);
  assert.equal(teamConfig({master:{provider:'claude'},models:[{provider:'claude'}],maxWorkers:10},10).maxWorkers,10);
});
test('unattended discovery, deduplication, graceful drain, delivery and next initiative',async()=>{
  const f=fixture();try{
    await select(f);const state=f.engine.state(),master=state.team!.current!.masterId!;
    assert.equal(f.discovered,1);assert.equal(state.backlog.length,1);assert.equal(state.starts,1);
    await f.act(master,{action:'plan',plan:'Implement and verify',tasks:[{id:'fix',title:'Fix drafts',instructions:'Preserve drafts',acceptance:'Refresh preserves drafts',files:['draft.ts'],dependencies:[]}]});
    await f.engine.control({action:'off'});assert.equal(f.engine.state().draining,true);
    await f.act(master,{action:'takeover',task:'fix',evidence:'Implemented and verified draft storage',complete:true});
    await f.act(master,{action:'finish',pr:'https://github.com/example/repo/pull/1',summary:'Fixed drafts',checks:'Independent checks passed'});
    await f.engine.tick();await f.engine.tick();assert.equal(f.engine.state().phase,'off');assert.equal(f.engine.state().backlog[0].status,'delivered');assert.equal(f.discovered,1);
    await f.engine.control({action:'on'});await f.engine.tick();const d=f.engine.state();assert.equal(f.discovered,2);
    await f.engine.worker(d.discovery!.workerId!,{action:'propose',revision:d.revision,items:[proposed],summary:'Already delivered'});assert.equal(f.engine.state().backlog.length,1);
  }finally{f.dispose();}
});
test('steering reaches the master between operations and requires authenticated acknowledgment',async()=>{
  const f=fixture();try{
    await select(f);const master=f.engine.state().team!.current!.masterId!;
    await f.engine.control({action:'steer',text:'Prioritize offline drafts'});f.workers.find(w=>w.id===master)!.status='idle';await f.engine.tick();
    assert.match(f.messages.at(-1)!,/Prioritize offline drafts/);const instruction=f.engine.state().steering[0];assert.equal(instruction.status,'pending');
    await assert.rejects(f.engine.worker('outsider',{action:'ack-steering',ids:[instruction.id]}),/Only this floor/);
    await f.engine.worker(master,{action:'ack-steering',ids:[instruction.id]});assert.equal(f.engine.state().steering[0].status,'applied');
  }finally{f.dispose();}
});
test('restart recovers a retained team without duplicate hires; stopped mode remains off',async()=>{
  const f=fixture();try{
    await select(f);const count=f.workers.length,active=f.engine.state().active;f.restart();await f.engine.tick();
    assert.equal(f.workers.length,count);assert.equal(f.engine.state().active,active);assert.equal(f.engine.state().team!.current!.phase,'running');
    await f.engine.control({action:'stop-now'});f.restart();await f.engine.tick();assert.equal(f.engine.state().enabled,false);assert.equal(f.workers.length,count);
    await f.engine.control({action:'on'});await f.engine.tick();assert.equal(f.engine.state().active,active);assert.equal(f.workers.length,count);
  }finally{f.dispose();}
});
test('runtime exhaustion preserves blocked work and authorization loss prevents discovery',async()=>{
  const f=fixture();try{
    await select(f);await f.engine.control({action:'off'});f.advance(121*60000);await f.engine.tick();
    assert.equal(f.engine.state().phase,'off');assert.equal(f.engine.state().backlog[0].status,'blocked');assert.match(f.engine.state().message,/preserved/);
    await f.engine.control({action:'on'});f.deny('Owner revoked');await f.engine.tick();assert.equal(f.engine.state().phase,'blocked');assert.equal(f.discovered,1);
  }finally{f.dispose();}
});
test('stale proposals, category violations and corrupt storage do not mutate or overwrite data',async()=>{
  const f=fixture();try{
    await f.engine.control({action:'configure',config:f.config});await f.engine.control({action:'on'});await f.engine.tick();const state=f.engine.state();
    await assert.rejects(f.engine.worker(state.discovery!.workerId!,{action:'propose',revision:state.revision-1,items:[proposed],summary:'stale'}),/Stale/);
    assert.equal(f.engine.state().backlog.length,0);writeFileSync(f.file,'{ broken');f.restart();assert.match(f.engine.error!,/Cannot read/);
    await assert.rejects(f.engine.control({action:'on'}),/Cannot read/);assert.equal(readFileSync(f.file,'utf8'),'{ broken');
  }finally{f.dispose();}
});
test('presence follows three-dimensional routes with synchronized stair height',()=>{
  const p={path:[[0,0,0],[0,3,4],[2,3,4]] as [number,number,number][],startedAt:1000,speed:1,face:2,activity:'Visiting'};
  assert.deepEqual(bossPosition(p,3500).at,[0,1.5,2]);assert.equal(bossPosition(p,3500).walking,true);
  assert.deepEqual(bossPosition(p,10000),{at:[2,3,4],walking:false,face:2});
});


test('OFF after empty discovery completes immediately despite the discovery interval',async()=>{
  const f=fixture();try{
    await f.engine.control({action:'configure',config:f.config});await f.engine.control({action:'on'});await f.engine.tick();
    const s=f.engine.state();await f.engine.control({action:'off'});
    await f.engine.worker(s.discovery!.workerId!,{action:'propose',revision:f.engine.state().revision,items:[],summary:'No useful work'});
    await f.engine.tick();await f.engine.tick();assert.equal(f.engine.state().phase,'off');assert.equal(f.engine.state().draining,false);
  }finally{f.dispose();}
});

test('independent checks report failures and interruption against the real commit',async()=>{
  const { verifyChecks }=await import('../src/server/boss-mode/checks.js');
  const { execFileSync }=await import('node:child_process');
  const dir=mkdtempSync(path.join(os.tmpdir(),'boss-checks-'));
  try{
    execFileSync('git',['init','-q'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-qm','baseline'],{cwd:dir});
    const records:import('../src/shared/boss-mode/types.js').BossCheck[]=[];
    await assert.rejects(verifyChecks(dir,['printf failure; exit 3'],new AbortController().signal,c=>records.push({...c})),/Independent check failed/);
    assert.equal(records.at(-1)?.exitCode,3);assert.equal(records.at(-1)?.commit.length,40);
    const controller=new AbortController(),pending=verifyChecks(dir,['sleep 10'],controller.signal,c=>records.push({...c}));setTimeout(()=>controller.abort(),50);
    await assert.rejects(pending,/failed|interrupted/);assert.equal(records.at(-1)?.exitCode,-1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('discovery steering reaches the worker at an idle checkpoint and blocks stale direction',async()=>{
  const f=fixture();try{
    await f.engine.control({action:'configure',config:f.config});await f.engine.control({action:'on'});await f.engine.tick();
    const id=f.engine.state().discovery!.workerId!;
    await f.engine.control({action:'steer',text:'Add a new car, not a Boss steering repair.'});
    await f.engine.tick();assert.equal(f.messages.length,0,'do not type into a busy terminal');
    await assert.rejects(f.engine.worker(id,{action:'propose',revision:f.engine.state().revision,items:[proposed],summary:'Old repair'}),/latest user direction/);
    f.workers.find(w=>w.id===id)!.status='idle';await f.engine.tick();
    assert.match(f.messages.at(-1)!,/Add a new car/);assert.match(f.messages.at(-1)!,/priority over your selected initiative/);
    assert.equal(f.engine.state().steering[0].status,'pending');
    await f.engine.tick();assert.equal(f.messages.length,1);
    await f.engine.worker(id,{action:'ack-steering',ids:f.engine.state().steering.map(s=>s.id)});
    await f.engine.worker(id,{action:'propose',revision:f.engine.state().revision,items:[],summary:'Applied direction; need car acceptance criteria'});
  }finally{f.dispose();}
});

test('mission changes reconsider queued ideas and reach the active master without deleting work',async()=>{
  const f=fixture();try{
    await select(f);const active=f.engine.state().active!,master=f.engine.state().team!.current!.masterId!;
    f.engine.mutate(s=>s.backlog.push({...proposed,id:'old-queued',title:'Unrelated repair',status:'queued',createdAt:0,attempts:0}));
    await f.engine.control({action:'configure',config:{...f.config,mission:'Add a new car'}});
    assert.equal(f.engine.state().backlog.find(i=>i.id==='old-queued')!.status,'suggested');
    assert.equal(f.engine.state().active,active);assert.equal(f.engine.state().team!.current!.masterId,master);
    f.workers.find(w=>w.id===master)!.status='idle';await f.engine.tick();
    assert.match(f.messages.at(-1)!,/Current mission: Add a new car/);assert.match(f.messages.at(-1)!,/Preserve existing commits and PRs/);
  }finally{f.dispose();}
});

test('failed discovery instruction delivery remains retryable across restart',async()=>{
  const f=fixture();try{
    await f.engine.control({action:'configure',config:f.config});await f.engine.control({action:'on'});await f.engine.tick();
    const id=f.engine.state().discovery!.workerId!;
    await f.engine.control({action:'steer',text:'Build the car feature first'});
    f.workers.find(w=>w.id===id)!.status='idle';const prompt=f.io.prompt;f.io.prompt=()=> 'Temporarily unavailable';
    await f.engine.tick();assert.equal(f.engine.state().steering[0].status,'acknowledged');
    f.io.prompt=prompt;f.restart();await f.engine.tick();
    assert.match(f.messages.at(-1)!,/Build the car feature first/);assert.equal(f.engine.state().steering[0].status,'pending');
  }finally{f.dispose();}
});

test('new user direction reopens selection instead of starting a previously queued repair',async()=>{
  const f=fixture();try{
    await f.engine.control({action:'configure',config:f.config});await f.engine.control({action:'on'});await f.engine.tick();
    let s=f.engine.state();await f.engine.worker(s.discovery!.workerId!,{action:'propose',revision:s.revision,items:[proposed],summary:'Repair proposed'});
    await f.engine.tick();
    await f.engine.control({action:'steer',text:'Only add the requested car now'});await f.engine.tick();
    s=f.engine.state();assert.equal(s.active,undefined);assert.ok(s.discovery);assert.equal(s.backlog[0].status,'suggested');
  }finally{f.dispose();}
});

test('active steering retries unacknowledged delivery at a later safe checkpoint',async()=>{
  const f=fixture();try{
    await select(f);const master=f.engine.state().team!.current!.masterId!;
    await f.engine.control({action:'steer',text:'Add the car first'});
    f.workers.find(w=>w.id===master)!.status='idle';await f.engine.tick();
    assert.equal(f.engine.state().steering[0].status,'pending');const count=f.messages.length;
    f.workers.find(w=>w.id===master)!.status='idle';await f.engine.tick();
    assert.equal(f.messages.length,count+1);assert.match(f.messages.at(-1)!,/Add the car first/);
    await f.engine.worker(master,{action:'ack-steering',ids:f.engine.state().steering.map(s=>s.id)});
    f.workers.find(w=>w.id===master)!.status='idle';await f.engine.tick();assert.equal(f.messages.length,count+1);
  }finally{f.dispose();}
});
