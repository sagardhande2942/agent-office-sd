import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { TeamAction, TeamState } from '../../shared/master-workers.js';
import { nextFreeSeat } from '../../shared/layout.js';
import { TeamCoordinator, type TeamAdapter } from './coordinator.js';
import { TeamPresets } from './storage.js';
const stores=new WeakMap<Ctx, Map<string, TeamCoordinator>>();
const presetStores=new WeakMap<Ctx, TeamPresets>();
const git=(dir:string,args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',timeout:20000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','pipe','pipe']}).trim();
export function teamPresets(ctx:Ctx) {
  let p=presetStores.get(ctx); if(!p) { p=new TeamPresets(path.join(ctx.cfg.dataDir,'master-workers-presets.json')); presetStores.set(ctx,p); } return p;
}
function broadcast(ctx:Ctx,floor:Floor,state:TeamState) { for(const c of ctx.clients.values()) if(c.peer.floor===floor.id) ctx.sendTo(c,{t:'master-workers',state}); }
export function broadcastTeams(ctx:Ctx) { for(const [id,s] of stores.get(ctx)??[]) { const f=ctx.floors.get(id); if(f) broadcast(ctx,f,s.state()); } }
export function team(ctx:Ctx,floor:Floor): TeamCoordinator {
  let all=stores.get(ctx); if(!all) stores.set(ctx,all=new Map());
  let s=all.get(floor.id); if(s) return s;
  const checkout=(id:string)=>{
    const w=floor.workers.get(id); if(!w?.worktree) throw Error('Participant worktree is missing');
    return {w,dir:path.resolve(floor.dir,w.worktree.path)};
  };
  const adapter:TeamAdapter={
    list:()=>floor.workers.list(),
    spawn:(a,prompt,owner,base,role)=>{
      if(!floor.project.agentProviders.includes(a.provider)) throw Error(`Provider ${a.provider} is not installed on this floor`);
      const desk=nextFreeSeat(id=>floor.workers.deskOccupied(id),floor.plan.wing);
      if(!desk) throw Error('No free desks: the master can work itself or wait for capacity');
      const w=floor.workers.spawn(desk.id,'Master / Workers',prompt,true,'agent',a.provider,a.model,a.effort,undefined,owner,[],undefined,undefined,undefined,base,role);
      if(typeof w==='string') throw Error(w); return w;
    },
    prompt:(id,prompt)=>{
      const w=floor.workers.get(id);
      if(!w) return 'Participant no longer exists';
      if(['offline','exited'].includes(w.status)) return floor.workers.resume(id,prompt);
      return floor.workers.prompt(id,prompt,'Master / Workers');
    },
    stop:id=>{ const w=floor.workers.get(id); if(w) void floor.workers.kill(id,'keep').catch(()=>{}); },
    head:(id,allowDirty=false)=>{
      const {dir,w}=checkout(id);
      if(!allowDirty&&git(dir,['status','--porcelain'])) throw Error('Commit or resolve the participant checkout before dispatch, acceptance or completion');
      if(git(dir,['branch','--show-current'])!==w.worktree!.branch) throw Error('Keep the assigned team branch');
      return git(dir,['rev-parse','HEAD']);
    },
    commits:(id,base,commits,failed=false)=>{
      const {dir}=checkout(id);
      if(!commits.every(c=>typeof c==='string'&&/^[0-9a-f]{7,40}$/.test(c))) throw Error('Provide hexadecimal commit IDs');
      const resolved=commits.map(c=>git(dir,['rev-parse','--verify',`${c}^{commit}`]));
      for(const c of resolved) {
        git(dir,['merge-base','--is-ancestor',c,'HEAD']);
        if(c===base) throw Error('Result commit must be newer than the assignment base');
        git(dir,['merge-base','--is-ancestor',base,c]);
      }
      if(!failed&&git(dir,['status','--porcelain'])) throw Error('Commit your task changes before submitting');
      const head=git(dir,['rev-parse','HEAD']);
      if(!failed&&head!==base&&!resolved.includes(head))throw Error('Include the worker branch head in its submitted commits');
      return [...new Set(resolved)];
    },
    prepare:(id,base)=>{const {dir}=checkout(id);try{if(git(dir,['status','--porcelain']))return false;git(dir,['merge','--ff-only',base]);return true;}catch{return false;}},
    contains:(id,commits)=>{ const {dir}=checkout(id); return commits.every(c=>{try{git(dir,['merge-base','--is-ancestor',c,'HEAD']);return true;}catch{return false;}}); },
    verifyPr:async(id,url)=>{
      const {dir,w}=checkout(id);
      if(git(dir,['status','--porcelain'])) throw Error('Finish and commit all integration work first');
      await floor.forge.pulls.refresh();
      const pr=floor.forge.pulls.items.find(p=>p.url===url);
      if(!pr) throw Error('PR not found on this floor; check forge authentication and URL');
      if(pr.state!=='OPEN' || pr.isDraft || pr.headRefName!==w.worktree!.branch) throw Error('Provide the open, non-draft PR for the master integration branch');
      const remoteHead=pr.headRefOid??git(dir,['ls-remote','--heads','origin',w.worktree!.branch]).split(/\s+/)[0];
      if(remoteHead!==git(dir,['rev-parse','HEAD'])) throw Error('Push the final verified integration commit before finishing');
      if(floor.forge.pulls.state.error) throw Error(floor.forge.pulls.state.error);
      if(floor.forge.pulls.items.filter(p=>p.state==='OPEN'&&p.headRefName===w.worktree!.branch).length!==1) throw Error('The integration branch must have exactly one open PR');
      if(pr.checks==='fail') throw Error('PR checks report a failure; resolve it before finishing');
      const report=w.completion;
      if(!report || report.status!=='ready' || report.revision!==(w.completionRevision??0) || report.pr!==pr.url || report.commit!==remoteHead) throw Error('Submit a ready completion checklist for this PR and final commit before finishing');
      const err=floor.workers.linkPr(id,{number:pr.number,url:pr.url}); if(err) throw Error(err);
    },
    changed:()=>{ const s=all!.get(floor.id); if(s) broadcast(ctx,floor,s.state()); },
  };
  s=new TeamCoordinator(path.join(floor.dir,'.agent-office','master-workers.json'),teamPresets(ctx),adapter);
  all.set(floor.id,s); return s;
}
export function startTeamClock(ctx:Ctx) {
  const timer=setInterval(()=>{
    for(const f of ctx.floors.values()) {
      const s=team(ctx,f); void s.tick().catch(()=>{});
    }
  },2000);timer.unref();return()=>clearInterval(timer);
}
export async function teamAction(ctx:Ctx,floor:Floor,id:string,body:TeamAction) { return team(ctx,floor).action(id,body); }
