import { randomUUID } from 'node:crypto';
import type { WorkerInfo } from '../../shared/protocol.js';
import { bossInitial, validateBossConfig } from '../../shared/boss-mode/config.js';
import { BOSS_CATEGORIES, type BossConfig, type BossControl, type BossItem, type BossState, type BossWorkerAction } from '../../shared/boss-mode/types.js';
import type { TeamCoordinator } from '../master-workers/coordinator.js';
import { load, save, text } from '../master-workers/storage.js';
export interface BossIO {
  now(): number; workers(): WorkerInfo[];
  allowed(config: BossConfig, owner?: string): string | undefined;
  discover(config: BossConfig, token: string, prompt: string, owner?: string): Promise<string>;
  stop(id: string): Promise<void>; suspend(id: string): void; prompt(id: string, message: string): string | undefined;
  team(item: BossItem, config: BossConfig, owner?: string): TeamCoordinator;
  fetch(): Promise<void>; openPrs(): number;
  feedback(items: BossItem[]): Promise<void>;
  changed(state: BossState): void;
}
const running = (w?: WorkerInfo) => !!w && ['starting','working','needs_input'].includes(w.status);
export class BossEngine {
  private data: BossState;
  private busy = false;
  private run?: TeamCoordinator;
  error?: string;
  constructor(private file: string, private io: BossIO, initial = bossInitial()) {
    this.data = initial;
    try {
      const raw = load<BossState>(file, initial);
      if (raw.version !== 1 || !Array.isArray(raw.backlog) || !Array.isArray(raw.events) || !Array.isArray(raw.steering) || !Array.isArray(raw.presets) || !Number.isInteger(raw.revision)) throw Error('Invalid Boss state');
      if(typeof raw.enabled!=='boolean'||typeof raw.draining!=='boolean'||!['off','discovering','planning','working','verifying','waiting','draining','blocked'].includes(raw.phase)||!Array.isArray(raw.checks)||typeof raw.day!=='string'||!Number.isInteger(raw.starts)||raw.starts<0||!Number.isInteger(raw.recovery)||raw.recovery<0)throw Error('Invalid Boss lifecycle state');
      raw.config = validateBossConfig(raw.config);
      if (raw.backlog.length > 500 || raw.events.length > 1000 || raw.steering.length > 100 || raw.presets.length > 100) throw Error('Boss state exceeds retention limits');
      for (const p of raw.presets) { p.config = validateBossConfig(p.config); text(p.name,'preset name',100); text(p.id,'preset ID',80); }
      for (const item of raw.backlog) { text(item.id,'initiative ID',80); if(!/^[a-zA-Z0-9_-]+$/.test(item.id)) throw Error('Invalid initiative ID'); this.validateItem(item); if(!['suggested','queued','active','delivered','rejected','blocked'].includes(item.status)||!Number.isInteger(item.attempts)||item.attempts<0)throw Error('Invalid initiative lifecycle'); if(item.config)item.config=validateBossConfig(item.config); }
      this.data = raw;
      if ((raw.enabled || raw.draining) && !raw.config.autoRecover) { raw.enabled=false; raw.draining=false; raw.phase='off'; raw.message='Restarted: turn on to reconcile preserved work.'; }
    } catch (e) { this.error = 'Cannot read Boss state: ' + (e as Error).message; this.data.phase='blocked'; this.data.message=this.error; }
  }
  state(): BossState {
    return structuredClone({ ...this.data, ...(this.run ? { team: this.run.state() } : {}), ...(this.error ? { error:this.error } : {}) });
  }
  private persist(revise = true) { if(this.error) throw Error(this.error); this.data.updatedAt=this.io.now(); if(revise)this.data.revision++; save(this.file,this.data); this.io.changed(this.state()); }
  private event(kind: string, message: string, initiative = this.data.active) {
    this.data.events.push({id:randomUUID(),at:this.io.now(),kind,message:message.slice(0,8000),initiative}); this.data.events=this.data.events.slice(-1000);
  }
  private status(phase: BossState['phase'], message: string) {
    if(this.data.phase===phase && this.data.message===message) return;
    this.data.phase=phase; this.data.message=message; this.persist();
  }
  private validateItem(v: unknown) {
    const p=v as BossItem;
    text(p.title,'title',240); text(p.problem,'problem',4000); text(p.evidence,'evidence',8000); text(p.benefit,'benefit',4000);
    if(!BOSS_CATEGORIES.includes(p.category)||!Number.isInteger(p.priority)||p.priority<1||p.priority>100) throw Error('Invalid initiative category or priority');
    if(!Array.isArray(p.acceptance)||!p.acceptance.length||p.acceptance.length>30) throw Error('Provide 1–30 acceptance criteria');
    p.acceptance.forEach(v=>text(v,'acceptance',2000));
    if(!Array.isArray(p.dependencies)||p.dependencies.length>100||p.dependencies.some(id=>typeof id!=='string')) throw Error('Invalid initiative dependencies');
  }
  async control(command: BossControl, owner?: string) {
    if(this.error) throw Error(this.error);
    // OFF intent may be recorded even while a fetch or feedback operation is running.
    if(command.action==='off') {
      this.data.enabled=false; this.data.draining=!!this.data.active || !!this.data.discovery;
      this.event('control','OFF requested: finishing the current initiative.');
      this.status(this.data.draining?'draining':'off',this.data.draining?'Turning off—finishing current work.':'Boss mode is off.'); this.persist(); return;
    }
    if(command.action==='stop-now') {
      this.data.enabled=false;this.data.draining=false;this.event('control','Stopped immediately; all work preserved.');this.persist();
      const d=this.data.discovery;if(d?.workerId) await this.io.stop(d.workerId);
      const run=this.run?.state().current;
      if(run) { for(const id of [run.masterId,...run.workers.map(w=>w.workerId)])if(id)this.io.suspend(id); try{this.run!.control('pause',this.data.owner);}catch{} }
      this.data.discovery=undefined;this.status('off','Stopped; turn on to reconcile preserved work.');return;
    }
    if(this.busy) throw Error('Boss is reconciling; retry shortly');
    switch(command.action) {
      case 'configure': {
        const config=validateBossConfig(command.config),error=this.io.allowed(config,owner??this.data.owner);if(error)throw Error(error);
        this.data.config=config;this.event('settings','Configuration saved; active work retains its selected models.');break;
      }
      case 'on': {
        text(this.data.config.mission,'mission'); if(!this.data.config.checks.length)throw Error('Configure independent verification commands'); const error=this.io.allowed(this.data.config,owner);if(error)throw Error(error);
        if(this.data.active && this.data.owner!==owner) throw Error('Resume preserved work with its original credential owner');
        this.data.owner=owner;this.data.enabled=true;this.data.draining=false;this.data.nextAt=undefined;this.data.recovery=0;
        this.event('control','Boss mode turned on.');this.data.phase='waiting';this.data.message='Reconciling work and selecting the next initiative.';break;
      }
      case 'steer': {
        const value=text(command.text,'steering instruction',8000);
        this.data.steering.push({id:randomUUID(),at:this.io.now(),text:value,status:'acknowledged'});
        this.data.steering=this.data.steering.slice(-100);this.event('steering',value);break;
      }
      case 'idea': {
        const category=command.category;if(!BOSS_CATEGORIES.includes(category)) throw Error('Invalid category');
        const title=text(command.title,'title',240),problem=text(command.problem,'problem',4000);
        this.add({title,problem,category,evidence:'User-submitted idea; research and define acceptance before implementation.',benefit:problem,acceptance:['Investigate this idea and establish executable acceptance criteria before implementation.'],priority:50,dependencies:[]},'suggested');break;
      }
      case 'prioritize': case 'reject': {
        const item=this.data.backlog.find(v=>v.id===command.id);if(!item||!['suggested','queued','blocked'].includes(item.status))throw Error('Only future work can be changed');
        if(command.action==='reject')item.status='rejected';else {if(!Number.isInteger(command.priority)||command.priority<1||command.priority>100)throw Error('Priority must be 1–100');item.priority=command.priority;if(item.status==='queued'||item.status==='blocked')item.status='queued';}
        this.event('roadmap',command.action+': '+item.title,item.id);break;
      }
      case 'preset-save': {
        const id=command.id??randomUUID(),name=text(command.name,'preset name',100);
        this.data.presets=this.data.presets.filter(p=>p.id!==id);if(this.data.presets.length>=100)throw Error('At most 100 presets');
        this.data.presets.push({id,name,config:structuredClone(this.data.config)});break;
      }
      case 'preset-delete':this.data.presets=this.data.presets.filter(p=>p.id!==command.id);break;
      default:throw Error('Unknown Boss control');
    }
    this.persist();
  }
  private add(value: Pick<BossItem,'title'|'problem'|'evidence'|'benefit'|'acceptance'|'category'|'priority'|'dependencies'>, status: BossItem['status']) {
    this.validateItem(value);
    const existing=this.data.backlog.find(i=>i.title.trim().toLowerCase()===value.title.trim().toLowerCase());
    if(existing){if(existing.status==='suggested')Object.assign(existing,value,{status});return;}
    if(this.data.backlog.length>=500)throw Error('Backlog full; reject or complete old work before adding initiatives');
    if(value.dependencies.some(id=>!this.data.backlog.some(i=>i.id===id)))throw Error('Unknown initiative dependency');
    this.data.backlog.push({...value,id:randomUUID(),status,createdAt:this.io.now(),attempts:0});
  }
  async worker(actor: string, action: BossWorkerAction) {
    if(this.error)throw Error(this.error);
    const discovery=this.data.discovery,role=this.run?.member(actor);
    if(actor!==discovery?.workerId&&role!=='master')throw Error('Only this floor’s active boss can report decisions');
    if(action.action==='propose') {
      if(actor!==discovery?.workerId||discovery.replied)throw Error('Not an active discovery session');
      if(action.revision!==this.data.revision)throw Error('Stale Boss revision: read state and resubmit');
      if(!Array.isArray(action.items)||action.items.length>20)throw Error('At most 20 proposals');
      for(const item of action.items){this.validateItem(item);if(!this.data.config.categories.includes(item.category))throw Error('Category is disabled');}
      const before=structuredClone(this.data.backlog);
      try { for(const item of action.items)this.add(item,this.data.config.initiativePolicy==='roadmap'&&item.category==='features'&&!this.data.config.roadmap.split('\n').map(v=>v.trim()).filter(Boolean).some(v=>item.evidence.includes(v))?'suggested':'queued'); }
      catch(e){this.data.backlog=before;throw e;}
      discovery.replied=true;this.event('discovery',text(action.summary,'discovery summary',8000));
    } else if(action.action==='ack-steering') {
      if(!Array.isArray(action.ids)||action.ids.length>100)throw Error('Invalid steering IDs');
      for(const id of action.ids){const s=this.data.steering.find(v=>v.id===id);if(!s)throw Error('Unknown steering ID');s.status='applied';s.appliedAt=this.io.now();}
    } else if(action.action==='focus') {
      const activity=text(action.activity,'activity',240);
      if(action.workerId&&!this.io.workers().some(w=>w.id===action.workerId&&this.run?.member(w.id)==='worker'))throw Error('Choose a worker in the current initiative');
      this.event('focus',activity,action.workerId);
    } else throw Error('Unknown Boss worker action');
    this.persist();return this.state();
  }
  private discoveryPrompt() {
    return 'You are the BOSS of this project. Research and prioritize valuable improvements. Do not edit, commit, push, merge or publish during discovery. Follow repository instructions.\nMISSION: '+this.data.config.mission+
      '\nCONFIG: '+JSON.stringify(this.data.config)+'\nBACKLOG: '+JSON.stringify(this.data.backlog.map(({id,title,status,pr})=>({id,title,status,pr})))+
      '\nSTEERING: '+JSON.stringify(this.data.steering.filter(s=>s.status!=='applied'))+
      '\nRead office-workers boss state, then submit office-workers boss action with JSON stdin: {action:"propose",revision:<current revision>,items:[{title,problem,evidence,benefit,acceptance:[...],category,priority:1..100,dependencies:[existing initiative IDs]}],summary}. Use evidence and repository goals, avoid duplicate or speculative work. Propose zero items when no useful work exists. In roadmap mode only propose features explicitly requested in the roadmap and quote their exact roadmap line in evidence; maintain enabled maintenance categories. Acknowledge applied steering with {action:"ack-steering",ids:[...]}. Stop after submitting.';
  }
  async tick() {
    if(this.busy||this.error||(!this.data.enabled&&!this.data.draining))return;
    this.busy=true;
    try {
      const at=this.io.now(),config=this.data.config,day=new Date(at).toISOString().slice(0,10);
      if(this.data.day!==day){this.data.day=day;this.data.starts=0;this.persist();}
      if(this.data.draining&&!this.data.active&&!this.data.discovery){this.data.draining=false;this.status('off','Boss mode is off; current work is complete.');return;}
      const error=this.io.allowed(config,this.data.owner);if(error){this.status('blocked',error);return;}
      if(this.data.nextAt&&at<this.data.nextAt&&!this.data.draining)return;
      if(this.data.active) { await this.work(at);return; }
      if(this.data.discovery) { await this.discovering(at);return; }
      if(this.data.draining){this.data.draining=false;this.status('off','Boss mode is off; current work is complete.');return;}
      if(this.data.nextAt&&at<this.data.nextAt)return;
      await this.io.feedback(this.data.backlog);
      if(!this.data.enabled)return;
      if(this.io.openPrs()>=config.maxOpenPrs){this.data.nextAt=at+60000;this.persist();this.status('waiting','Outstanding PR limit reached; waiting for delivery capacity.');return;}
      if(this.data.starts>=config.dailyStarts){this.data.nextAt=Date.parse(day+'T00:00:00.000Z')+86400000;this.persist();this.status('waiting','Daily initiative limit reached; resets at midnight UTC.');return;}
      const item=this.data.backlog.filter(i=>i.status==='queued'&&config.categories.includes(i.category)&&i.dependencies.every(id=>this.data.backlog.some(d=>d.id===id&&d.status==='delivered'&&(!d.pr||d.merged))))
        .sort((a,b)=>b.priority-a.priority||a.createdAt-b.createdAt)[0];
      await this.io.fetch(); if(!this.data.enabled)return;
      if(item){
        this.data.active=item.id;item.status='active';item.config??=structuredClone(config);item.startedAt=at;item.attempts++;this.data.starts++;this.data.recovery=0;this.persist();
        this.run=this.io.team(item,item.config??config,this.data.owner);
        if(item.followup && this.run.state().current) this.run.continue(item.followup);
        else this.run.start({master:config.boss,models:[...new Map(config.models.map(m=>[JSON.stringify([m.provider,m.model??'',m.effort??'']),m])).values()],maxWorkers:config.maxWorkers,
          brief:item.title+'\n'+item.problem+'\nEvidence: '+item.evidence+'\nBenefit: '+item.benefit,requirements:item.acceptance,
          constraints:config.constraints+'\nStanding mission: '+config.mission+'\nDo not merge. Follow repository instructions and preserve other work.'},this.data.owner);
        this.event('initiative','Started '+item.title,item.id);this.status('working','Working on '+item.title);return;
      }
      const token=randomUUID();this.data.discovery={id:token,startedAt:at};this.event('discovery','Inspecting the project for the next useful initiative.');this.persist();
      this.data.discovery.workerId=await this.io.discover(config,token,this.discoveryPrompt(),this.data.owner);
      this.status('discovering','Researching and prioritizing improvements.');this.persist();
    } catch(e) {
      const message=(e as Error).message;this.data.recovery++;
      this.data.nextAt=this.io.now()+Math.min(300000,15000*2**this.data.recovery);
      this.event('error',message);this.status('blocked',message);this.persist();
      if((this.data.draining||this.data.active)&&this.data.recovery>this.data.config.recoveryAttempts)await this.abandon(message);
    } finally {this.busy=false;}
  }
  private async discovering(at:number) {
    const d=this.data.discovery!;
    d.workerId??=this.io.workers().find(w=>w.masterWorkers?.id==='boss-discovery-'+d.id)?.id;
    const w=this.io.workers().find(w=>w.id===d.workerId);
    if(d.replied){if(d.workerId)await this.io.stop(d.workerId);this.data.discovery=undefined;this.data.nextAt=this.data.backlog.some(i=>i.status==='queued')?undefined:at+this.data.config.discoveryMinutes*60000;this.persist();return;}
    if(at-d.startedAt>this.data.config.runtimeMinutes*60000||(!running(w)&&w?.status!=='idle')) {
      if(d.workerId)await this.io.stop(d.workerId);this.data.discovery=undefined;this.data.nextAt=at+this.data.config.discoveryMinutes*60000;this.event('blocked','Discovery ended without proposals; work preserved.');this.persist();return;
    }
    if(w?.status==='idle')this.io.prompt(w.id,'Read office-workers boss state and submit evidence-backed proposals or an empty proposal set before ending discovery.');
  }
  private async work(at:number) {
    const item=this.data.backlog.find(i=>i.id===this.data.active);if(!item)throw Error('Active initiative missing');
    this.run??=this.io.team(item,item.config??this.data.config,this.data.owner);
    const state=this.run.state(),r=state.current;
    if(state.error)throw Error(state.error);
    if(!r) { await this.abandon('Initiative launch was interrupted; preserved intent was not dispatched.'); return; }
    if(at-(item.startedAt??at)>(item.config??this.data.config).runtimeMinutes*60000){await this.abandon('Initiative runtime limit reached.');return;}
    if(['paused','stopped'].includes(r.phase)) {
      if(this.data.recovery>=this.data.config.recoveryAttempts){await this.abandon(r.error??'Recovery attempts exhausted.');return;}
      this.data.recovery++;this.persist();this.run.continue('Reconcile existing tasks, commits and PR before continuing. Preserve unfinished work.');this.event('recovery','Resuming retained initiative.');
    }
    for(const s of this.data.steering.filter(s=>s.status==='acknowledged')){
      const current=this.run.state().current;if(current?.masterId&&current.notifications[current.masterId])break;
      this.run.enqueue('USER STEERING '+s.id+': '+s.text+'\nApply at a safe checkpoint, preserve completed work, update pending tasks, and report office-workers boss action {action:"ack-steering",ids:["'+s.id+'"]}.');s.status='pending';this.persist();
    }
    await this.run.tick();
    const run=this.run.state().current!;item.run=run;item.branch=run.masterWorktree?.branch;
    if(run.phase==='done') {
      item.status='delivered';item.pr=run.pr;item.finishedAt=at;item.followup=undefined;
      this.event('delivery',run.summary??item.title,item.id);
      this.run.control('stop',this.data.owner);this.run=undefined;this.data.active=undefined;this.data.recovery=0;this.persist();return;
    }
    const label=this.data.draining?'Turning off—finishing '+item.title:'Working on '+item.title;
    const verifying=run.tasks.length>0&&run.tasks.every(t=>t.status==='done')&&this.data.checks.at(-1)?.finishedAt===undefined&&this.data.checks.length>0;
    this.status(this.data.draining?'draining':verifying?'verifying':(run.plan?'working':'planning'),verifying?'Running independent verification':label);
  }
  private async abandon(reason:string) {
    const item=this.data.backlog.find(i=>i.id===this.data.active);
    if(item){item.status='blocked';item.error=reason;item.run=this.run?.state().current??item.run;}
    if(this.run?.state().current)this.run.control('stop',this.data.owner);
    this.run=undefined;this.data.active=undefined;this.data.nextAt=this.io.now()+this.data.config.discoveryMinutes*60000;
    this.event('blocked',reason);if(this.data.draining){this.data.draining=false;this.data.enabled=false;}
    this.status(this.data.enabled?'waiting':'off',reason+' Unfinished work preserved.');this.persist();
  }
  setPresence(presence:BossState['presence']) { this.data.presence=presence;this.persist(false); }
  mutate(action:(state:BossState)=>void) { action(this.data);this.persist(); }
}
