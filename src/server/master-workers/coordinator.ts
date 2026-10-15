import { definition, validateGraph, dispatchContract, owns } from './contracts.js';
import { metrics, notify, report, monitor, checkpoint } from './monitoring.js';
import { replaceTasks, recoveryBudget } from './recovery.js';
import { randomUUID } from 'node:crypto';
import type { TaskObservation } from '../../shared/team-coordination.js';
import type { AgentChoice, WorkerInfo } from '../../shared/protocol.js';
import type { TeamAction, TeamAttempt, TeamRequest, TeamRun, TeamState, TeamTask } from '../../shared/master-workers.js';
import { load, modelKey, request, restored, save, text, TeamPresets } from './storage.js';
import { masterPrompt, workerPrompt } from './prompts.js';
import { recordEvent, recordAssignment, recordBlocker, recordControl, recordFinalPr, recordIntegration, recordPlan, recordResult, recordRetry, recordReview, recordRecovery, recordStart } from '../task-replay/index.js';
export interface TeamAdapter {
  list(): WorkerInfo[];
  spawn(choice: AgentChoice, prompt: string, owner?: string, base?: { commit: string; from: string }, role?: WorkerInfo['masterWorkers']): WorkerInfo;
  prompt(id: string, prompt: string): string | undefined;
  stop(id: string): void;
  head(id: string, allowDirty?: boolean): string;
  commits(id: string, base: string, commits: string[], failed?: boolean): string[];
  contains(id: string, commits: string[]): boolean;
  prepare(id: string, base: string): boolean;
  verifyPr(id: string, url: string): Promise<void>;
  changed(): void;
  now?(): number;
  observe?(id: string, base: string): Promise<TaskObservation>;
  changedPaths?(id: string, base: string, head?: string): string[];
  /** Future optional budget policy. No new spending policy is active by default. */
  allowDispatch?(run: TeamRun, choice: AgentChoice): string | undefined;
}
const active = (w: WorkerInfo) => ['starting','working','needs_input'].includes(w.status);
export class TeamCoordinator {
  private current: TeamRun | null = null;
  private past: TeamRun[] = [];
  error?: string;
  private busy = false;
  private observing = new Set<string>();
  private observe(r:TeamRun,t:TeamTask,a:TeamAttempt) {
    const id=a.assignmentId;
    if(!id||!this.io.observe||this.observing.has(id)||this.now()-(a.observation?.at??0)<60000)return;
    this.observing.add(id);
    void (async()=>{
      let observation:TaskObservation;
      try{observation=await this.io.observe!(a.workerId,a.base);}catch{observation={at:this.now(),paths:[],error:'Worktree observation unavailable'};}
      if(this.current===r&&r.phase==='running'&&t.status==='running'&&t.attempts.at(-1)===a&&a.assignmentId===id){
        a.observation=observation;try{this.persist();}catch{r.error='Could not persist worktree observation';}
      }
      this.observing.delete(id);
    })();
  }
  private now() { return this.io.now?.() ?? Date.now(); }
  recordResponse(bytes:number) { if(this.current){metrics(this.current).responseBytes+=bytes;save(this.file,{current:this.current,past:this.past});} }
  constructor(private file: string, readonly presets: TeamPresets, private io: TeamAdapter, private maxWorkers = 5) {
    try {
      const stored = restored(load(file, { current: null, past: [] }), maxWorkers); this.current = stored.current; this.past = stored.past;
      if (this.current && ['starting','running','paused'].includes(this.current.phase)) {
        const r=this.current, roster=this.io.list().filter(w=>w.masterWorkers?.id===r.id);
        r.masterId ??= roster.find(w=>w.masterWorkers?.role==='master')?.id;
        r.masterWorktree ??= roster.find(w=>w.id===r.masterId)?.worktree;
        for(const w of roster.filter(w=>w.masterWorkers?.role==='worker')) {
          const a=r.tasks.find(t=>t.id===w.masterWorkers?.task)?.attempts.at(-1);
          if(a&&!a.workerId){a.workerId=w.id;if(!r.workers.some(p=>p.workerId===w.id))r.workers.push({workerId:w.id,choice:a.choice});}
        }
        const previous = this.current.phase;
        this.current.phase = 'paused'; this.current.error = 'Office restarted: resume to reconcile team state';
        if (previous !== 'paused') recordRecovery(this.current, this.current.error);
        this.persist();
      }
    } catch (e) { this.error = `Cannot read team activity: ${(e as Error).message}`; }
  }
  state(): TeamState { return structuredClone({ current: this.current, past: this.past, presets: this.presets.state(), ...(this.error || this.presets.error ? { error: this.error ?? this.presets.error } : {}) }); }
  member(id: string): 'master' | 'worker' | undefined {
    const r = this.current;
    return r?.masterId === id ? 'master' : r?.workers.some(w => w.workerId === id) ? 'worker' : undefined;
  }
  private persist() { save(this.file, { current: this.current, past: this.past }); this.io.changed(); }
  private update() { if (this.current) this.current.revision++; this.persist(); }
  start(raw: TeamRequest, owner?: string) {
    if (this.error) throw Error(this.error);
    if (this.current && !['done','stopped'].includes(this.current.phase)) throw Error('Close or stop the current team first');
    const req = request(raw, this.maxWorkers);
    if (this.current) this.past = [...this.past, this.current].slice(-10);
    const r: TeamRun = { ...req, id: randomUUID(), owner, createdAt: this.now(), revision: 0, phase: 'starting', workers: [], tasks: [], notifications: {} };
    const started = recordStart(r, req);
    this.current = r; this.persist();
    try {
      const master = this.io.spawn(req.master, masterPrompt(r), owner, undefined, {id:r.id,role:'master'});
      r.masterId = master.id; r.masterWorktree = master.worktree; r.phase = 'running';
      if (started) started.participantId = master.id;
      this.update();
    } catch (e) { r.phase = 'paused'; r.error = (e as Error).message; recordControl(r, 'pause', `Master failed to start: ${r.error}`); this.update(); }
  }
  control(action: 'pause' | 'resume' | 'stop', owner?: string) {
    const r = this.current;
    if (this.busy) throw Error('Another team operation is in progress; retry control shortly');
    if (!r) throw Error('No team activity');
    if (r.owner && r.owner !== owner) throw Error('Only the activity owner can control this team');
    if (action === 'stop') {
      if (r.phase !== 'done') r.phase = 'stopped';
      recordControl(r, 'stop'); this.snapshot(); this.update();
      for (const id of [r.masterId, ...r.workers.map(w => w.workerId)]) if (id) this.io.stop(id);
      return;
    }
    if (['done','stopped'].includes(r.phase)) throw Error('This activity has ended');
    if (action === 'pause') { const was = r.phase; r.phase = 'paused'; if (was !== 'paused') recordControl(r, 'pause'); this.update(); return; }
    const was = r.phase;
    if (!r.masterId) {
      const master = this.io.spawn(r.master, masterPrompt(r), r.owner, undefined, {id:r.id,role:'master'});
      r.masterId = master.id; r.masterWorktree = master.worktree;
    }
    this.io.head(r.masterId,true); // Preserve partial work while reconciling interrupted runs.
    r.phase = 'running'; delete r.error;
    if(was!=='running')for(const t of r.tasks){const a=t.attempts.at(-1);if(t.status==='running'&&a){a.reportingSince=this.now();for(const v of a.alerts??[])if(v.kind==='unknown'&&!v.clearedAt)v.clearedAt=this.now();}}
    r.notifications[r.masterId] = `Resume activity ${r.id}. Read team_state and inbox, reconcile existing commits and accepted tasks; do not duplicate work or PRs.`;
    if (was !== 'running') recordControl(r, 'resume');
    this.update();
    const list=this.io.list();
    const master=list.find(w=>w.id===r.masterId);
    if(master&&['offline','exited'].includes(master.status)){
      const prompt=r.notifications[r.masterId];delete r.notifications[r.masterId];this.update();
      const error=this.io.prompt(r.masterId,prompt);if(error){r.phase='paused';r.error=error;recordControl(r, 'pause', `Resume failed: ${error}`);this.update();}
    }
    if(r.phase==='running')for(const t of r.tasks){
      const a=t.attempts.at(-1),w=list.find(w=>w.id===a?.workerId);
      if(t.status==='running'&&a&&w&&['offline','exited'].includes(w.status)){
        const error=this.io.prompt(w.id,workerPrompt(r,t)+'\nResume existing work; inspect your branch and avoid duplicate commits.');
        if(error){a.status='failed';a.summary=error;t.status='pending';recordBlocker(r, { task: t, workerId: w.id, summary: `Task ${t.id} could not resume`, message: error });this.notify(r,`task ${t.id} could not resume`);this.update();}
      }
    }
  }
  /** Reopen retained work explicitly, preserving its commits, task graph and original branch. */
  continue(message: string) {
    const r = this.current;
    if (!r) throw Error('No retained activity');
    if (['done','stopped'].includes(r.phase)) { r.phase = 'paused'; this.update(); }
    this.control('resume', r.owner);
    this.enqueue(message);
  }
  /** Coordinator notices are delivered between terminal operations. */
  enqueue(message: string) {
    const r = this.current;
    if (!r?.masterId) throw Error('Master is unavailable');
    r.notifications[r.masterId] = (r.notifications[r.masterId] ?? '') + '\n' + message;
    this.update();
  }
  private run(actor: string, b: TeamAction): TeamRun {
    const r = this.current;
    if (this.error) throw Error(this.error);
    if (!r || !this.member(actor) || b.id !== r.id) throw Error('Not a participant in this activity');
    if (r.phase !== 'running' && !(r.phase === 'paused' && ['result','progress','acknowledge'].includes(b.action))) throw Error(`Team is ${r.phase}; resume it before making changes`);
    if (!['progress','acknowledge'].includes(b.action) && b.revision !== r.revision) throw Error('Stale activity revision: read team_state and retry without repeating completed work');
    return r;
  }
  private task(r: TeamRun, id: string) { const t = r.tasks.find(t => t.id === id); if (!t) throw Error('Unknown task'); return t; }
  private ready(r: TeamRun, t: TeamTask) {
    if (!t.dependencies.every(id => this.task(r,id).status === 'done')) throw Error('Task dependencies are not integrated');
  }
  private notify(r: TeamRun, message: string) { notify(r,`Team update: ${message}. Read compact team_state; inspect task details only as needed. Preserve completed work.`); }
  async action(actor: string, b: TeamAction) {
    if (this.busy) throw Error('Another team operation is in progress; read state and retry');
    this.busy = true;
    try {
      const r = this.run(actor,b);
      if (['progress','acknowledge'].includes(b.action)) {
        if(report(r,actor,b as Extract<TeamAction,{action:'progress'|'acknowledge'}>,this.now()))this.persist();
        return this.state();
      }
      if (b.action !== 'result' && actor !== r.masterId) throw Error('Only the master can plan, dispatch, review, take over or finish');
      switch (b.action) {
        case 'plan': {
          const plan = text(b.plan,'plan',60000);
          if (!Array.isArray(b.tasks) || !b.tasks.length || b.tasks.length > 100) throw Error('Provide 1–100 tasks');
          const tasks: TeamTask[] = b.tasks.map(t => {
            const candidate=definition(t),old=r.tasks.find(v=>v.id===t.id);
            if(old&&(old.status!=='pending'||old.attempts.length)){
              const fields=(v:TeamTask)=>[v.title,v.instructions,v.acceptance,v.files,v.dependencies,v.specification];
              if(JSON.stringify(fields(old))!==JSON.stringify(fields(candidate)))throw Error('Started task definitions cannot be changed');
              return old;
            }
            return {...candidate,...(old?.recoveryRoot?{recoveryRoot:old.recoveryRoot}:{})};
          });
          if(r.tasks.some(t=>(t.status!=='pending'||t.attempts.length||t.recoveryRoot)&&!tasks.some(v=>v.id===t.id)))throw Error('Keep started tasks and unique IDs');
          validateGraph(tasks);const designSummary=b.designSummary===undefined?r.designSummary:text(b.designSummary,'concise design summary',4000);
          r.tasks=tasks;r.plan=plan;r.designSummary=designSummary;
          recordPlan(r, plan, tasks); break;
        }
        case 'dispatch': {
          if (!r.plan) throw Error('Publish a plan first');
          const t = this.task(r,b.task); this.ready(r,t);
          if (['done','running','review','takeover','superseded'].includes(t.status)) throw Error('Task cannot be dispatched in its current state');
          dispatchContract(r.tasks,t); recoveryBudget(r,t.id);
          if(!r.designSummary)throw Error('Publish a concise designSummary before dispatch');
          const selected = r.models.find(m=>modelKey(m)===modelKey(b.choice) && m.effort===b.choice.effort);
          if (!selected) throw Error('Model is not in the approved pool');
          if (t.attempts.length >= 2 || t.attempts.some(a=>modelKey(a.choice)===modelKey(selected))) throw Error('Retry requires one different eligible model; otherwise take over');
          const reason = text(b.reason,'model selection reason',2000);
          const policy = this.io.allowDispatch?.(r,selected); if (policy) throw Error(policy);
          const base = this.io.head(r.masterId!);
          const list = this.io.list();
          const occupied = new Set(r.tasks.filter(v=>['running','review'].includes(v.status)).flatMap(v=>v.attempts.slice(-1).map(a=>a.workerId)));
          let worker = r.workers.map(p=>list.find(w=>w.id===p.workerId)).find((w): w is WorkerInfo => !!w && modelKey({provider:w.provider!,model:w.model})===modelKey(selected) && w.effort===selected.effort && !occupied.has(w.id) && !active(w));
          // Reuse only when its branch already contains the master's latest base.
          if (worker && !this.io.prepare(worker.id,base)) worker = undefined;
          const live = r.workers.filter(p=>list.some(w=>w.id===p.workerId));
          if (!worker && live.length >= r.maxWorkers) {
            const idle=live.map(p=>list.find(w=>w.id===p.workerId)!).find(w=>!occupied.has(w.id)&&!active(w));
            if(!idle) throw Error('Team is at its worker limit; wait for a result or take over');
            this.snapshot(); this.io.stop(idle.id); // preserve its branch and history, free its seat
          }
          // Reserve the attempt before launch so interrupted starts cannot redispatch silently.
          const pending: TeamAttempt = {workerId:'',choice:selected,base,status:'running',assignmentId:randomUUID(),designSummary:r.designSummary,startedAt:this.now(),reportingSince:this.now(),specification:structuredClone(t.specification)};
          t.status = 'running'; t.reason = reason; t.attempts.push(pending); this.update();
          try {
            if (worker) {
              pending.workerId = worker.id; this.update();
              const err = this.io.prompt(worker.id, workerPrompt(r,t)); if (err) throw Error(err);
            } else {
              worker = this.io.spawn(selected,workerPrompt(r,t),r.owner,{commit:base,from:r.masterWorktree!.branch},{id:r.id,role:'worker',task:t.id});
              pending.workerId = worker.id; r.workers.push({workerId:worker.id,choice:selected});
            }
            const dispatched = { task: t, workerId: worker.id, attempt: t.attempts.length, choice: selected, reason };
            if (t.attempts.length === 1) recordAssignment(r, dispatched); else {recordRetry(r, dispatched);metrics(r).retries++;}
          } catch (e) {
            pending.status = 'failed'; pending.summary = (e as Error).message; t.status = 'pending';
            recordBlocker(r, { task: t, workerId: pending.workerId || undefined, summary: `Task ${t.id} could not launch`, message: (e as Error).message });
            this.notify(r,`task ${t.id} could not launch`); this.update(); throw e;
          }
          break;
        }
        case 'result': {
          const t = this.task(r,b.task), a = t.attempts.at(-1);
          if (!a || a.workerId !== actor || a.status !== 'running' || t.status !== 'running') throw Error('No running assignment for this worker');
          if(a.assignmentId && b.assignmentId!==a.assignmentId)throw Error('Submit the current assignmentId');
          if(a.assignmentId && a.acknowledgedAt===undefined)throw Error('Acknowledge assignment before submitting');
          const summary=text(b.summary,'result summary'), checks=text(b.checks,'checks and evidence');
          if (!Array.isArray(b.commits) || b.commits.length > 100) throw Error('Provide at most 100 commit IDs');
          if (b.failed !== undefined && typeof b.failed !== 'boolean') throw Error('failed must be a boolean');
          const commits=this.io.commits(actor,a.base,b.commits,b.failed);
          if(a.assignmentId&&!b.failed)a.submittedHead=this.io.head(actor);
          for(const v of a.alerts??[])if(!v.clearedAt)v.clearedAt=this.now();
          a.summary=summary; a.checks=checks; a.commits=commits; a.status=b.failed?'failed':'submitted'; t.status=b.failed?'pending':'review';
          recordResult(r, { task: t, workerId: actor, summary, checks, commits, failed: b.failed === true });
          this.snapshot(); this.notify(r,`task ${t.id} ${b.failed?'failed':'has a result to review'}`); break;
        }
        case 'checkpoint': checkpoint(r,b.task,b.alertId,b.response,this.now()); break;
        case 'replace': replaceTasks(r,b.task,b.tasks,b.evidence); break;
        case 'request_changes': {
          const t=this.task(r,b.task),a=t.attempts.at(-1);
          if(t.status!=='review'||a?.status!=='submitted')throw Error('No submitted result to correct');
          if(a.corrections)throw Error('Correction round exhausted; retry or take over');
          const feedback=text(b.evidence,'specific review findings',4000);
          // Verify the session still exists before recording a correction request.
          if(!this.io.list().some(w=>w.id===a.workerId))throw Error('Worker unavailable; reject and recover');
          a.previousResults=[{summary:a.summary??'',checks:a.checks??'',commits:a.commits??[],review:feedback}];
          a.corrections=1;a.startedAt??=this.now();a.designSummary??=r.designSummary;a.correctionFeedback=feedback;a.assignmentId=randomUUID();a.progress=undefined;a.acknowledgedAt=undefined;a.reportingSince=this.now();a.alerts=[];
          a.status='running';t.status='running';delete a.commits;delete a.summary;delete a.checks;
          metrics(r).corrections++;
          r.notifications[a.workerId]=workerPrompt(r,t)+'\nREVIEW FINDINGS: '+feedback+'\nInspect existing changes, address the findings, rerun checks and submit the current branch head. Do not create another PR.';
          recordEvent(r,{type:'correction',taskId:t.id,participantId:actor,summary:'Changes requested from the same worker',details:{reviewReason:feedback,commits:a.previousResults[0].commits}});
          break;
        }
        case 'cancel': {
          const t=this.task(r,b.task),a=t.attempts.at(-1);
          if(t.status!=='running'||!a)throw Error('No running assignment to cancel');
          const evidence=text(b.evidence,'cancellation evidence');this.snapshot();this.io.stop(a.workerId);
          a.status='failed';a.summary=evidence;t.status='pending';delete r.notifications[a.workerId];
          for(const v of a.alerts??[])if(!v.clearedAt)v.clearedAt=this.now();
          recordBlocker(r, { task: t, workerId: a.workerId || undefined, summary: `Assignment cancelled for task ${t.id}`, evidence });
          break;
        }
        case 'review': {
          const t=this.task(r,b.task), a=t.attempts.at(-1);
          if (t.status!=='review' || a?.status!=='submitted') throw Error('No submitted result to review');
          const evidence=text(b.evidence,'review evidence');
          if (b.accept !== true && b.accept !== false) throw Error('Provide accept:true or false');
          if(b.accept&&a.assignmentId){
            if(!this.io.changedPaths)throw Error('Host lacks scope verification; update host');
            const changed=this.io.changedPaths(a.workerId,a.base,a.submittedHead);
            const outside=changed.filter(p=>!owns(t.files,p));
            if(outside.length&&!b.scopeException)throw Error('Out-of-scope changes: '+outside.join(', ')+'; provide a reviewed scopeException');
            if(b.scopeException)text(b.scopeException,'reviewed scope exception',4000);
          }
          if (b.accept) this.io.head(actor);
          if (b.accept && !this.io.contains(actor,a.commits??[])) throw Error('Integrate submitted commits into the master branch before acceptance');
          a.review=evidence+(b.scopeException?'\nScope exception reviewed: '+b.scopeException:''); a.status=b.accept?'accepted':'rejected'; t.status=b.accept?'done':'pending';
          recordReview(r, { task: t, workerId: actor, outcome: b.accept ? 'accepted' : 'rejected', reason: a.review });
          if (b.accept) {
            t.integrated=a.commits; t.evidence=evidence;
            recordIntegration(r, { task: t, workerId: actor, commits: a.commits ?? [], verified: 'Independent git check: submitted commits verified as ancestors of the master branch HEAD via git merge-base' });
          }
          break;
        }
        case 'takeover': {
          const t=this.task(r,b.task); this.ready(r,t);
          if (['done','superseded'].includes(t.status) || ['running','review'].includes(t.status)) throw Error('Resolve active worker result before taking over');
          const evidence=text(b.evidence,'master takeover evidence');
          if(b.complete !== undefined && typeof b.complete !== 'boolean') throw Error('complete must be a boolean');
          const head = b.complete ? this.io.head(actor) : undefined;
          if(t.status!=='takeover')metrics(r).takeovers++;
          t.evidence=evidence; t.status=b.complete?'done':'takeover';
          recordReview(r, { task: t, workerId: actor, outcome: 'takeover', reason: evidence });
          if (b.complete) recordIntegration(r, { task: t, workerId: actor, commits: head ? [head] : [], verified: 'Independent git check: the master branch HEAD is clean and on the team integration branch' });
          break;
        }
        case 'finish': {
          if (!r.plan || !r.tasks.length || r.tasks.some(t=>!['done','superseded'].includes(t.status))) throw Error('Finish every task first');
          const summary=text(b.summary,'completion summary'), checks=text(b.checks,'final verification evidence'), pr=text(b.pr,'PR URL',1000);
          await this.io.verifyPr(actor,pr);
          recordFinalPr(r, { pr, summary, checks, verified: `Independent PR validation: open non-draft PR on branch ${r.masterWorktree?.branch ?? 'the team branch'}, its head matches the master's pushed HEAD, exactly one open PR for the branch, forge checks report no failure, and the completion checklist matches the final commit` });
          r.summary=summary; r.checks=checks; r.pr=pr; r.phase='done'; r.notifications={}; this.snapshot(); break;
        }
        default: throw Error('Unknown team action');
      }
      this.update(); return this.state();
    } finally { this.busy=false; }
  }
  private snapshot() {
    const r=this.current; if (!r) return;
    const list=this.io.list();
    r.masterUsage=list.find(w=>w.id===r.masterId)?.usage ?? r.masterUsage;
    for (const p of r.workers) { p.usage=list.find(w=>w.id===p.workerId)?.usage ?? p.usage; for (const t of r.tasks) for (const a of t.attempts) if(a.workerId===p.workerId) a.usage=p.usage; }
  }
  async tick() {
    const r=this.current; if (!r || r.phase!=='running' || this.busy) return;
    this.busy=true;
    try {
      const list=this.io.list(), master=list.find(w=>w.id===r.masterId);
      if (!master || ['offline','exited'].includes(master.status)) { r.phase='paused'; r.error='Master is unavailable; resume after checking its terminal and checkout'; recordControl(r, 'pause', r.error); this.snapshot(); this.update(); return; }
      let changed=false,observed=false;
      for (const t of r.tasks) {
        const a=t.attempts.at(-1); if(t.status!=='running' || !a) continue;
        const w=list.find(v=>v.id===a.workerId);
        if(monitor(r,t,a,this.now()))observed=true;
        this.observe(r,t,a);
        if(w?.status==='needs_input' && a.notice!=='needs_input'){a.notice='needs_input';recordBlocker(r, { task: t, workerId: a.workerId || undefined, summary: `Task ${t.id} needs input`, message: 'Worker reported needs_input; awaiting master guidance' });this.notify(r,`task ${t.id} needs input; inspect its blocker, cancel/retry or take over if appropriate`);changed=true;}
        else if(w&&w.status!=='needs_input'&&a.notice){delete a.notice;changed=true;}
        if ((!w || ['offline','exited','done'].includes(w.status)) && !r.notifications[a.workerId]) {
          a.status='failed'; a.summary='Worker stopped without submitting a result; inspect and preserve its work'; t.status='pending'; recordBlocker(r, { task: t, workerId: a.workerId || undefined, summary: `Task ${t.id} worker stopped without a result`, message: 'Worker exited without submitting a result; its work was preserved' }); this.notify(r,`task ${t.id} stopped without a result`); changed=true;
        }
      }
      for (const [id,message] of Object.entries(r.notifications)) {
        const w=list.find(v=>v.id===id);
        if (!w || !(id===r.masterId?['idle','done']:['idle','done','offline','exited']).includes(w.status)) continue;
        delete r.notifications[id];
        this.persist(); // Delivery intent does not change orchestration revision.
        const err=this.io.prompt(id,message);
        if(err) { r.notifications[id]=message; r.error=err; observed=true; }
        else {
          if(id===r.masterId){metrics(r).masterNotices++;for(const t of r.tasks)for(const v of t.attempts.at(-1)?.alerts??[])if(!v.deliveredAt&&!v.clearedAt)v.deliveredAt=this.now();}
          observed=true;
        }
      }
      if(changed) { this.snapshot(); this.update(); } else if(observed)this.persist();
    } catch(e) { r.phase='paused'; r.error=(e as Error).message; recordControl(r, 'pause', r.error); this.update(); }
    finally { this.busy=false; }
  }
}
