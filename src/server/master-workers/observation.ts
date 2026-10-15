import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { TaskObservation } from '../../shared/team-coordination.js';
const run=promisify(execFile);
const options={encoding:'utf8' as const,timeout:5000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}};
export async function observeWorktree(dir:string,base:string):Promise<TaskObservation> {
  const git=async(args:string[])=>(await run('git',args,{...options,cwd:dir})).stdout;
  const [head,names,untracked,stats]=await Promise.all([
    git(['rev-parse','HEAD']),git(['diff','--no-renames','--name-only','-z',base,'--']),
    git(['ls-files','--others','--exclude-standard','-z']),git(['diff','--numstat',base,'--'])
  ]);
  const counts=stats.split('\n').map(s=>s.split('\t'));
  return {at:Date.now(),head:head.trim(),paths:[...new Set((names+untracked).split('\0').filter(Boolean))].slice(0,100),additions:counts.reduce((n,r)=>n+(Number(r[0])||0),0),deletions:counts.reduce((n,r)=>n+(Number(r[1])||0),0)};
}
export function changedPaths(dir:string,base:string,head='HEAD') {
  return execFileSync('git',['diff','--no-renames','--name-only','-z',base,head,'--'],{...options,cwd:dir}).split('\0').filter(Boolean);
}
