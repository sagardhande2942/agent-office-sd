import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { floorBoss } from '../src/server/boss-mode/service.js';
import { bossDefaults } from '../src/shared/boss-mode/config.js';
test('real Boss service dispatches ten workers, enforces roles, independently checks delivery and drains without a browser',{timeout:45000},async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'boss-service-')),bin=path.join(dir,'bin');mkdirSync(bin);
  const fake='#!'+process.execPath+'\nif(process.argv.includes("--version")){console.log("1.0.0");process.exit(0);}setInterval(()=>{},1000);\n';
  for(const name of ['claude','codex'])writeFileSync(path.join(bin,name),fake,{mode:0o755});
  const pulls=path.join(dir,'pulls.json');writeFileSync(pulls,'[]');
  writeFileSync(path.join(bin,'gh'),'#!'+process.execPath+'\nimport {readFileSync} from "node:fs";const a=process.argv.slice(2);console.log(a[0]==="pr"&&a[1]==="list"&&a[a.indexOf("--state")+1]==="open"?readFileSync('+JSON.stringify(pulls)+',"utf8"):"[]");\n',{mode:0o755});
  const previous=process.env.PATH;process.env.PATH=bin+path.delimiter+previous;
  const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(dir,'init','-q','-b','main');writeFileSync(path.join(dir,'README.md'),'# fixture\n');git(dir,'add','README.md');git(dir,'-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','baseline');
  const cfg=loadConfig([dir,'--password','boss-test','--no-open','--agent',path.join(bin,'claude')]);cfg.port=0;
  const office=await startServer(cfg);
  git(dir,'add','.gitignore','.agent-office/knowledge');git(dir,'-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','seed knowledge');
  try {
    const floor=office.floors()[0],boss=floorBoss(floor),base='http://127.0.0.1:'+office.hookPort;
    const call=async(id:string,endpoint:string,body?:unknown)=>{
      const saved=JSON.parse(readFileSync(path.join(dir,'.agent-office','workers.json'),'utf8')).find((w:any)=>w.id===id);
      const response=await fetch(base+endpoint+'?worker='+id,{method:body?'POST':'GET',headers:{authorization:'Bearer '+saved.hookToken,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json() as any};
    };
    await boss.control({action:'configure',config:{...bossDefaults({provider:'claude',model:'opus'}),mission:'Inspect the repository and deliver verified improvements',models:[{provider:'codex',model:'gpt-5.4-mini'}],maxWorkers:10,checks:['true']}});
    await boss.control({action:'on'});await boss.tick();let state=boss.state();const discovery=state.discovery!.workerId!;
    const response=await call(discovery,'/office/workers/boss',{action:'propose',revision:state.revision,items:[{title:'Inspect and document modules',problem:'Module roles need documentation',evidence:'README has no module inventory',benefit:'Clear maintenance responsibilities',category:'documentation',priority:90,dependencies:[],acceptance:['Inspect all ten areas and document the result']}],summary:'Identified a documented maintenance task'});
    assert.equal(response.status,200,JSON.stringify(response.body));await boss.tick();await boss.tick();state=boss.state();const master=state.team!.current!.masterId!;
    const act=async(actor:string,body:Record<string,unknown>)=>{const r=(await call(master,'/office/team')).body.current;return call(actor,'/office/team',{id:r.id,revision:r.revision,...body});};
    assert.equal((await act(master,{action:'plan',plan:'Inspect ten independent areas',tasks:Array.from({length:10},(_,i)=>({id:'area-'+i,title:'Inspect area '+i,instructions:'Inspect README and report maintenance observations; research only',acceptance:'Document observed evidence',files:[],dependencies:[]}))})).status,200);
    for(let i=0;i<10;i++){const result=await act(master,{action:'dispatch',task:'area-'+i,choice:{provider:'codex',model:'gpt-5.4-mini'},reason:'Independent research assignment'});assert.equal(result.status,200,JSON.stringify(result.body));}
    state=boss.state();assert.equal(state.team!.current!.workers.length,10);assert.equal(floor.workers.list().length,11);
    const worker=state.team!.current!.workers[0].workerId;
    assert.equal((await call(worker,'/office/workers/boss',{action:'focus',activity:'Claim boss authority'})).status,400);
    assert.equal((await call(worker,'/office/workers/pr',{pr:1})).status,403);
    await boss.control({action:'off'});assert.equal(boss.state().draining,true);
    for(let i=0;i<10;i++){
      const id=state.team!.current!.workers[i].workerId;
      assert.equal((await act(id,{action:'result',task:'area-'+i,summary:'README inspected; module inventory missing',commits:[],checks:'Read README evidence'})).status,200);
      assert.equal((await act(master,{action:'review',task:'area-'+i,accept:true,evidence:'Confirmed research evidence'})).status,200);
    }
    const masterDir=path.resolve(dir,floor.workers.get(master)!.worktree!.path);writeFileSync(path.join(masterDir,'inventory.md'),'# Module inventory\nVerified fixture evidence.\n');git(masterDir,'add','inventory.md');git(masterDir,'-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','inventory');const head=git(masterDir,'rev-parse','HEAD'),url='https://github.com/example/fixture/pull/1';
    writeFileSync(pulls,JSON.stringify([{number:1,title:'Inventory',state:'OPEN',isDraft:false,url,headRefName:floor.workers.get(master)!.worktree!.branch,headRefOid:head,baseRefName:'main',author:{login:'tester'},labels:[],body:'Verified inventory',statusCheckRollup:[]} ]));
    assert.equal((await call(master,'/office/workers/knowledge',{action:'review_done',changed:[],none_reason:'Fixture inventory task; no additional durable knowledge'})).status,200);
    const revision=(await call(master,'/office/workers/completion')).body.revision;
    assert.equal((await call(master,'/office/workers/complete',{revision,summary:'Inventory delivered',checks:[{name:'fixture',status:'passed',evidence:'README inspected'}],files:['inventory.md'],pr:url,commit:head})).status,200);
    const done=await act(master,{action:'finish',pr:url,summary:'Inventory delivered',checks:'Verification pending office execution'});assert.equal(done.status,200,JSON.stringify(done.body));
    assert.equal(boss.state().checks.at(-1)?.exitCode,0);assert.equal(boss.state().checks.at(-1)?.commit,head);
    await boss.tick();await boss.tick();assert.equal(boss.state().phase,'off');assert.equal(boss.state().backlog[0].pr,url);assert.equal(floor.workers.get(master)?.suspended,true);
    assert.equal(git(dir,'status','--porcelain','--untracked-files=no'),'');
  }finally{office.shutdown();process.env.PATH=previous;await new Promise(r=>setTimeout(r,150));rmSync(dir,{recursive:true,force:true});}
});
