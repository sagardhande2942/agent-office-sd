import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { changedPaths, observeWorktree } from '../src/server/master-workers/observation.js';

test('Git observations include committed, working and untracked activity; scope checks catch both rename paths',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'team-observe-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
 try{
  git('init','-q','-b','main');writeFileSync(path.join(dir,'allowed.ts'),'one\n');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','base');const base=git('rev-parse','HEAD');
  git('mv','allowed.ts','outside.ts');git('-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','rename');const head=git('rev-parse','HEAD');
  writeFileSync(path.join(dir,'outside.ts'),'one\ntwo\n');writeFileSync(path.join(dir,'new [file].ts'),'untracked\n');
  const observation=await observeWorktree(dir,base);assert.equal(observation.head,head);assert.ok(observation.paths.includes('new [file].ts'));assert.ok(observation.paths.includes('outside.ts'));assert.ok(observation.additions!>0);
  assert.deepEqual(changedPaths(dir,base,head).sort(),['allowed.ts','outside.ts']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
