import { planOf, type MapPlan } from '../../shared/maps/index.js';
import type { MapState } from '../../shared/protocol.js';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Floor, FloorContext } from '../floor.js';
import type { AgentChoice, ServerMsg, WorkerInfo } from '../../shared/protocol.js';
import type { BossConfig, BossItem, BossState } from '../../shared/boss-mode/types.js';
import { bossInitial, choiceKey } from '../../shared/boss-mode/config.js';
import { BossEngine } from './engine.js';
import { TeamCoordinator } from '../master-workers/coordinator.js';
import { TeamPresets } from '../master-workers/storage.js';
import { teamAdapter } from '../master-workers/runtime.js';
import { registerTeamSession } from '../team-sessions.js';
import { validateWorkerModel, validateWorkerEffort } from '../agents.js';
import { gh, originRepo } from '../forge.js';
import { nextFreeSeat } from '../../shared/layout.js';
import { verifyChecks } from './checks.js';
import { presenceFor } from './presence.js';
import { feedback } from './delivery.js';
export class BossService {
  readonly engine: BossEngine;
  private runs = new Map<string,TeamCoordinator>();
  private disposers: (()=>void)[]=[];
  private timer?: NodeJS.Timeout;
  private controller?: AbortController;
  private closing=false;
  private presence='';
  private remoteGrant?: {until:number; room:number; owner?:string; allowed:boolean; plan?:MapPlan};
  constructor(readonly floor: Floor, private ctx: FloorContext, private publish: (message: ServerMsg)=>void) {
    const initial=bossInitial({provider:floor.project.agentProviders.find(p=>p!=='custom')??'claude'});
    try {const pkg=JSON.parse(readFileSync(path.join(floor.dir,'package.json'),'utf8'));initial.config.checks=['typecheck','test','build'].filter(k=>typeof pkg.scripts?.[k]==='string').map(k=>'npm run '+k);}catch{}
    this.engine=new BossEngine(path.join(floor.dir,'.agent-office','boss-mode.json'),{
      now:()=>Date.now(),workers:()=>floor.workers.list(),allowed:(config,owner)=>this.allowed(config,owner),
      discover:async(config,token,prompt,owner)=>{
        this.beforeSpawn(owner);const recovered=floor.workers.list().find(w=>w.masterWorkers?.id==='boss-discovery-'+token);if(recovered)return recovered.id;
        const desk=nextFreeSeat(id=>floor.workers.deskOccupied(id),floor.plan.wing);if(!desk)throw Error('No free desk for the boss');
        const worker=floor.workers.spawn(desk.id,'Boss discovery',prompt,true,'agent',config.boss.provider,config.boss.model,config.boss.effort,undefined,owner,[],undefined,undefined,undefined,undefined,{id:'boss-discovery-'+token,role:'master'});
        if(typeof worker==='string')throw Error(worker);this.mark(worker,'boss');return worker.id;
      },
      suspend:id=>{const error=floor.workers.suspend(id);if(error)throw Error(error);},
      stop:async id=>{if(floor.workers.get(id)){const result=await floor.workers.kill(id,'keep');if(result.error)throw Error(result.error);}},
      prompt:(id,message)=>floor.workers.prompt(id,message,'Boss mode'),
      team:(item,config,owner)=>this.createTeam(item,config,owner),
      fetch:async()=>{await floor.workers.fetchBase();},openPrs:()=>this.engine.state().backlog.filter(i=>i.pr&&floor.forge.pulls.items.some(p=>p.url===i.pr&&p.state==='OPEN')).length,
      feedback:items=>feedback(this,items),changed:state=>publish({t:'boss.state',floor:floor.id,state}),
    },initial);
    this.timer=setInterval(()=>{void this.tick().catch(error=>ctx.toast(floor,'Boss mode: '+(error as Error).message,'warn'));},2000);this.timer.unref();
  }
  state(){return this.engine.state();}
  private mark(worker:WorkerInfo,role:'boss'|'worker') {worker.bossMode={floor:this.floor.id,role};}
  allowed(config:BossConfig,owner?:string):string|undefined {
    if(!this.floor.project.branch)return 'Boss mode requires a Git project';
    if(this.ctx.mayAct && !this.ctx.mayAct(owner))return 'Boss owner no longer has admin access';
    if(!this.ctx.mayAct&&(!this.remoteGrant||this.remoteGrant.until<Date.now()||!this.remoteGrant.allowed||this.remoteGrant.owner!==owner && (this.engine.state().enabled || this.engine.state().draining)))return 'Waiting for office authorization and capacity lease';
    const as=this.ctx.forgeAs(owner,this.floor.forge?.kind??'github');if(typeof as==='string')return as;
    for(const a of [config.boss,...config.models]){
      if(!this.floor.project.agentProviders.includes(a.provider))return 'Provider '+a.provider+' is not installed on this floor';
      const error=validateWorkerModel('agent',a.provider,a.model)??validateWorkerEffort('agent',a.provider,a.effort);if(error)return error;
    }
    return undefined;
  }
  capacity(room:number,owner:string|undefined,allowed:boolean,map?:MapState) {
    if(map && (typeof map.pick!=='string'||!Array.isArray(map.custom)||map.custom.length>24))throw Error('Invalid navigation grant');
    this.remoteGrant={until:Date.now()+45000,room,owner,allowed,plan:map?planOf(map.pick,map.custom):undefined};
  }
  beforeSpawn(owner?:string) {
    const error=this.allowed(this.engine.state().config,owner);if(error)throw Error(error);
    if(this.ctx.ledger.hiringPaused)throw Error(this.ctx.ledger.hiringPaused);
    if(this.ctx.capacity.room()<=0||this.remoteGrant&&this.remoteGrant.room<=0)throw Error('Waiting for office worker capacity');
    if(this.remoteGrant)this.remoteGrant.room--;
  }
  private createTeam(item:BossItem,config:BossConfig,owner?:string) {
    const previous=this.runs.get(item.id);if(previous)return previous;
    const base=teamAdapter(this.floor,()=>{if(!this.closing)this.publish({t:'boss.state',floor:this.floor.id,state:this.engine.state()});},()=>this.beforeSpawn(owner));
    const retire=base.stop;base.stop=id=>{const worker=this.floor.workers.get(id);if(worker?.masterWorkers?.role==='master')this.floor.workers.suspend(id);else retire(id);};
    const spawn=base.spawn; base.spawn=(choice,prompt,who,from,role)=>{
      const extra='\nBOSS MODE: Read office-workers boss state for standing instructions. Record focus with office-workers boss action {action:"focus",workerId:"worker ID",activity:"Reviewing changes"}. Acknowledge applied steering with ack-steering and instruction IDs. Never merge; the office enforces delivery policy.';
      const worker=spawn(choice,prompt+extra,who,from,role);this.mark(worker,role?.role==='master'?'boss':'worker');return worker;
    };
    base.allowDispatch=(run,selected)=>{
      const current=this.engine.state().config;
      const active=run.tasks.filter(t=>['running','review'].includes(t.status)).map(t=>t.attempts.at(-1)).filter(Boolean);
      if(active.length>=current.maxWorkers)return 'Current Boss worker limit reached; let active assignments finish';
      if(config.workerMode==='slots'){
        const total=config.models.filter(m=>choiceKey(m)===choiceKey(selected)).length;
        if(active.filter(a=>choiceKey(a!.choice)===choiceKey(selected)).length>=total)return 'Configured worker slots for this model are occupied';
      }
      return undefined;
    };
    const verify=base.verifyPr;base.verifyPr=async(id,url)=>{
      const worker=this.floor.workers.get(id);if(!worker?.worktree)throw Error('Integration worktree missing');
      const error=this.allowed(config,owner);if(error)throw Error(error);
      this.controller=new AbortController();
      this.engine.mutate(state=>{state.phase='verifying';state.message='Running independent checks for '+item.title;});
      const as=this.ctx.forgeAs(owner,this.floor.forge.kind);if(typeof as==='string')throw Error(as);
      try {
        await verifyChecks(path.resolve(this.floor.dir,worker.worktree.path),config.checks,this.controller.signal,check=>{
          this.engine.mutate(state=>{state.checks=state.checks.filter(c=>c.startedAt!==check.startedAt||c.command!==check.command);state.checks.push({...check});state.checks=state.checks.slice(-100);});
        },as?.env);
        await verify(id,url);
      } finally {this.controller=undefined;}
    };
    const team=new TeamCoordinator(path.join(this.floor.dir,'.agent-office','boss-team-'+item.id+'.json'),new TeamPresets(path.join(this.floor.dir,'.agent-office','boss-team-presets.json')),base,10);
    this.runs.set(item.id,team);
    this.disposers.push(registerTeamSession(this.floor,{member:id=>team.member(id),state:()=>team.state(),action:async(id,body)=>{
      const state=this.engine.state();if(!state.enabled&&!state.draining)throw Error('Boss is off; turn on to continue preserved work');
      const error=this.allowed(config,owner);if(error)throw Error(error);
      if(body.action==='review'||body.action==='cancel'){
        const task=team.state().current?.tasks.find(t=>t.id===body.task),worker=task?.attempts.at(-1)?.workerId;
        if(worker)await this.engine.worker(id,{action:'focus',workerId:worker,activity:'Reviewing '+(task?.title??'worker result')});
      }
      return team.action(id,body);
    }}));return team;
  }
  async tick() {
    if(this.closing)return;
    await this.floor.ready;
    const before=this.engine.state(),active=before.backlog.find(i=>i.id===before.active);
    if(active?.startedAt&&Date.now()-active.startedAt>(active.config??before.config).runtimeMinutes*60000)this.controller?.abort();
    await this.engine.tick();
    const state=this.engine.state();
    for(const w of this.floor.workers.list())if(w.masterWorkers?.id===state.team?.current?.id||w.masterWorkers?.id==='boss-discovery-'+state.discovery?.id)this.mark(w,w.masterWorkers?.role==='worker'?'worker':'boss');
    if(state.config.mission||state.events.length){
      const presence=presenceFor(state,this.floor,{...this.ctx,navigation:()=>this.ctx.navigation?.()??this.remoteGrant?.plan??planOf('office')}),key=JSON.stringify(presence);
      if(key!==this.presence){this.presence=key;this.engine.setPresence(presence);}
    }
  }
  async control(control:import('../../shared/boss-mode/types.js').BossControl,owner?:string) {
    if(control.action==='stop-now')this.controller?.abort();
    return this.engine.control(control,owner);
  }
  async merge(number:number,head:string,owner?:string) {
    if(this.floor.forge.kind!=='github')throw Error('Automatic merging requires GitHub commit-specific checks');
    const repo=originRepo(this.floor.dir);if(!repo)throw Error('Cannot verify the publication repository');
    const as=this.ctx.forgeAs(owner,'github');if(typeof as==='string')throw Error(as);
    await gh(['pr','merge',String(number),'--repo',repo,'--squash','--match-head-commit',head],this.floor.dir,90000,as?.env);
  }
  shutdown(){const state=this.engine.state();if(!state.config.autoRecover){for(const w of this.floor.workers.list())if(w.bossMode?.floor===this.floor.id)this.floor.workers.suspend(w.id);}this.closing=true;clearInterval(this.timer);this.controller?.abort();this.disposers.forEach(fn=>fn());}
}
const services=new WeakMap<Floor,BossService>();
export function installFloorBoss(floor:Floor,ctx:FloorContext,publish:(msg:ServerMsg)=>void){const service=new BossService(floor,ctx,publish);services.set(floor,service);return service;}
export function floorBoss(floor:Floor){const service=services.get(floor);if(!service)throw Error('Boss service is not installed');return service;}
export function closeFloorBoss(floor:Floor){services.get(floor)?.shutdown();services.delete(floor);}
