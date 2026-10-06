import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {loadConfig} from '../src/server/config.js';
import {startServer} from '../src/server/server.js';
import {main} from '../bin/office-plan.js';
import {request,plan,verdict} from './fixtures/plan-review.js';
import {PROVIDER_META, type AgentProvider} from '../src/shared/providers.js';

for(const provider of ['codex','pi','cursor','grok','muse'] as AgentProvider[]) {
  test(`${provider}: real office accepts CLI plan submission and restarts winner without planning permissions`,{timeout:30000},async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),`office-plan-${provider}-`));
    const binary=path.join(dir,PROVIDER_META[provider].bin!),log=path.join(dir,'launches.jsonl');
    writeFileSync(binary,`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),role:process.env.AGENT_OFFICE_PLAN_ROLE,worker:process.env.AGENT_OFFICE_WORKER_ID})+'\\n');\nsetInterval(()=>{},1000);\n`,{mode:0o755});
    const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    git('init','-q','-b','main');writeFileSync(path.join(dir,'README.md'),'# Fixture\n');git('add','README.md');git('-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','Initial');
    const cfg=loadConfig([dir,'--password','test','--no-open','--agent',binary]);cfg.port=0;
    const office=await startServer(cfg);
    const wait=async(check:()=>boolean)=>{const end=Date.now()+7000;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert.ok(check());};
    try {
      const floor=office.floors()[0];await floor.ready;
      const choice={provider,model:provider==='pi'?'openai/gpt-5':provider==='muse'?'muse-spark':'gpt-5'};
      assert.equal(floor.planReviews.start({...request,candidates:[choice],reviewer:choice},'test'),undefined);
      const activity=floor.planReviews.state().current!,candidate=activity.candidates[0];
      // Fake CLIs only record launches. The test supplies their ready signal and tool requests.
      floor.workers.get(activity.reviewer.workerId)!.status='idle';
      const records=()=>readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l));
      await wait(()=>{try{return records().length===2;}catch{return false;}});
      const planning=records().find(r=>r.worker===candidate.workerId);
      if(provider==='codex') assert.ok(planning.args.includes('read-only'));
      else assert.ok(planning.args.some((a:string)=>a.includes('office-plan.js')));
      if(provider==='cursor') assert.ok(planning.args.includes('--mode=plan'));
      const saved=JSON.parse(readFileSync(path.join(dir,'.agent-office/workers.json'),'utf8'));
      const bridge=async(id:string,role:string,tool:string,body?:unknown)=>{
        const worker=saved.find((w:{id:string})=>w.id===id);
        const env={AGENT_OFFICE_WORKER_ID:id,AGENT_OFFICE_HOOK_URL:`http://127.0.0.1:${office.hookPort}`,AGENT_OFFICE_HOOK_TOKEN:worker.hookToken,AGENT_OFFICE_PLAN_ROLE:role};
        const errors:string[]=[];
        const result=await main([tool],{env,out:()=>{},err:(s:string)=>errors.push(s),read:async()=>JSON.stringify(body)});
        assert.equal(result,0,errors.join('\n'));
      };
      await bridge(candidate.workerId,'candidate','submit_candidate_plan',{id:activity.id,planRevision:0,plan});
      await wait(()=>floor.planReviews.state().current!.phase==='reviewing');
      await bridge(activity.reviewer.workerId,'reviewer','submit_plan_review',verdict(floor.planReviews.state().current!,[8]));
      await wait(()=>records().some(r=>r.worker===candidate.workerId&&!r.role));
      const winner=records().find(r=>r.worker===candidate.workerId&&!r.role);
      assert.ok(!winner.args.includes('--mode=plan'));
      assert.ok(!winner.args.includes('read-only'));
      assert.equal(floor.planReviews.state().current!.phase,'implementing');
    } finally {office.shutdown();await new Promise(r=>setTimeout(r,250));rmSync(dir,{recursive:true,force:true});}
  });
}
