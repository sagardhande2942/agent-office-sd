import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../src/server/config.js';
import {startServer} from '../src/server/server.js';

test('worker checklist is authenticated, survives persistence, clears on new work and guards Stop once',{timeout:30000},async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'office-completion-'));
 const cfg=loadConfig([dir,'--password','checklist-test','--no-open','--agent',process.execPath]);cfg.port=0;cfg.agentArgs=['-e','setInterval(()=>{},1000)'];
 const office=await startServer(cfg);
 try {
  const floor=office.floors()[0];await floor.ready;
  const ada=await floor.workers.spawn('desk-1','tester','Build API',false,'agent','custom');assert.ok(typeof ada !== 'string');
  const token=JSON.parse(readFileSync(path.join(dir,'.agent-office/workers.json'),'utf8')).find((w:any)=>w.id===ada.id).hookToken;
  const call=async(action:string,body?:object,bearer=token)=>{const res=await fetch(`http://127.0.0.1:${office.hookPort}/office/workers/${action}?worker=${ada.id}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:res.status,body:await res.json() as any};};
  const hook=async(event:string,payload:object={})=>{const res=await fetch(`http://127.0.0.1:${office.hookPort}/hooks/claude?worker=${ada.id}&event=${event}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({session_id:'ada-root',...payload})});return await res.json() as any;};
  await hook('SessionStart');await hook('UserPromptSubmit',{prompt:'Build API'});
  assert.equal((await call('completion',undefined,'wrong')).status,401);
  const revision=(await call('completion')).body.revision;
  assert.equal((await hook('Stop')).decision,'block');assert.equal(floor.workers.get(ada.id)!.status,'working');
  assert.deepEqual(await hook('Stop',{stop_hook_active:true}),{});
  const report={revision,summary:'API implemented',checks:[{name:'Tests',status:'failed',evidence:'One failing contract test'}],files:['src/api.ts'],prNote:'Not ready to publish'};
  assert.equal((await call('complete',{...report,revision:revision-1})).status,400);
  assert.equal((await call('complete',report)).body.report.status,'needs-attention');
  const updated={...report,checks:[{name:'Tests',status:'passed',evidence:'42 tests pass'}]};
  assert.equal((await call('complete',updated)).body.report.status,'ready');
  const stored=JSON.parse(readFileSync(path.join(dir,'.agent-office/workers.json'),'utf8')).find((w:any)=>w.id===ada.id);assert.equal(stored.completion.summary,'API implemented');
  assert.deepEqual(await hook('Stop'),{});
  await hook('UserPromptSubmit',{prompt:'Build API'});
  assert.equal((await call('completion')).body.report,null,'even the same prompt starts a fresh turn');
  await hook('UserPromptSubmit',{prompt:'Now build the frontend'});
  const next=(await call('completion')).body;assert.equal(next.report,null);assert.ok(next.revision>revision);
  assert.equal((await call('complete',updated)).status,400);
  assert.equal((await hook('Stop')).decision,'block');
 } finally {office.shutdown();await new Promise(r=>setTimeout(r,300));rmSync(dir,{recursive:true,force:true});}
});
