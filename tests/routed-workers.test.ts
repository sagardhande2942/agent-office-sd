import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { RoutedWorkers } from '../src/server/task-routing/workers.js';
import { DEFAULT_WORKFLOW } from '../src/shared/meeting-workflows.js';
import { taskProblem } from '../src/server/task-routing/bridge.js';
import { meetingArtifacts } from '../src/server/task-routing/results.js';
import { recordMeetingReview, memoryMeetingFor, assertMeetingWrite } from '../src/server/knowledge/meetings.js';

function fixture(t:any){
  const root=mkdtempSync(path.join(tmpdir(),'desk-task-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
  git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');writeFileSync(path.join(root,'README.md'),'# Fixture');git('add','.');git('commit','-qm','initial');
  const workers:any[]=[],prompts:string[]=[];let ids=0;
  const floor:any={def:{dir:root},meetings:{state:()=>({spaces:[]})},workers:{
    defaultProvider:'codex',officeDefault:{provider:'codex'},list:()=>workers,deskOccupied:(id:string)=>workers.some(w=>w.deskId===id),activeSince:()=>false,
    spawn(...args:any[]){const w={id:'w'+(++ids),kind:'agent',name:'Worker',deskId:args[0],prompt:args[2],status:'done',worktree:args[16]?.worktree,routedTask:args[16]?.id};workers.push(w);prompts.push(w.prompt);return w;},
    prompt(_id:string,text:string){prompts.push(text);},write(){},async kill(id:string){const i=workers.findIndex(w=>w.id===id);if(i>=0)workers.splice(i,1);return {};},
  }};
  const ctx:any={capacity:{room:()=>4-workers.length},ledger:{},toast(){}};
  let service=new RoutedWorkers(floor,ctx);t.after(()=>service.close());
  const w=structuredClone(DEFAULT_WORKFLOW);w.roles=['Writer'];w.stages=[{label:'Task',turns:[{seats:[0],output:true,prompt:'Review this document once'}]}];
  const task:any={id:'doc-1',execution:'worker',group:'documents',title:'Document check',version:1,workflow:w,input:{},references:[]};
  const state=(id='1234567890abcdef')=>JSON.parse(readFileSync(path.join(root,'.agent-office/worker-tasks',id,'meetings.json'),'utf8')).current;
  return {root,floor,workers,prompts,task,state,get service(){return service;},restart(){service.close();service=new RoutedWorkers(floor,ctx);}};
}

test('routed desk task uses one ordinary worker, scoped memory, exact archives and restart recovery',async t=>{
  const f=fixture(t);assert.equal(taskProblem(f.task),undefined);
  await f.service.start(f.task,'execution-doc-1','1234567890abcdef');assert.equal(f.workers.length,1);
  assert.equal(f.workers[0].meeting,undefined);assert.ok(!f.workers[0].deskId.includes('meeting'));
  let m=f.state();assert.equal(m.seats.length,1);assert.equal(m.turns.length,1);
  assert.ok(memoryMeetingFor(f.floor,f.workers[0]));
  assert.throws(()=>assertMeetingWrite(m,f.workers[0],'write','decisions/unsafe.md'));
  f.restart();assert.equal(f.workers.length,1);assert.equal(f.service.find('execution-doc-1')?.id,m.id);
  m=f.state();const cwd=path.resolve(f.root,m.worktree.path),out=path.join(cwd,m.output);
  f.workers[0].status='working';f.service.pump();mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({summary:'Checked'}));writeFileSync(out+'.md','# Checked');
  recordMeetingReview(f.root,m,f.workers[0],[],'No new durable findings');f.workers[0].status='done';
  assert.equal(f.service.find('execution-doc-1')?.state,'done');f.restart();
  assert.equal(f.service.find('execution-doc-1')?.state,'done');
  const refs=meetingArtifacts(f.floor,[m.id]);assert.equal(refs.references.length,1);assert.ok(refs.files.some(x=>x.content.includes('Checked')));
  await f.service.retire(m.id,'execution-doc-1');assert.equal(f.workers.length,0);
  assert.equal(f.service.find('execution-doc-1')?.state,'done');
  await assert.rejects(()=>f.service.start(f.task,'execution-doc-1',m.id),/already recorded/);
});

test('worker task contracts refuse multiple seats, unknown modes and incomplete output stages',t=>{
  const f=fixture(t);
  for(const mutate of [(v:any)=>v.workflow.roles.push('Peer'),(v:any)=>v.execution='unknown',(v:any)=>v.workflow.stages[0].turns[0].output=false]){
    const task=structuredClone(f.task);mutate(task);assert.ok(taskProblem(task));
  }
});
