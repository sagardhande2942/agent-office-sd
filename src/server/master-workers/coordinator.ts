import { randomUUID } from 'node:crypto';
import type { AgentChoice, Usage, WorkerInfo } from '../../shared/protocol.js';
import type { TeamAction, TeamAttempt, TeamRequest, TeamRun, TeamState, TeamTask } from '../../shared/master-workers.js';
import { load, modelKey, request, restored, save, text, TeamPresets } from './storage.js';
import { masterPrompt, workerPrompt } from './prompts.js';
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
  /** Future optional budget policy. No new spending policy is active by default. */
  allowDispatch?(run: TeamRun, choice: AgentChoice): string | undefined;
}
const active = (w: WorkerInfo) => ['starting','working','needs_input'].includes(w.status);
export class TeamCoordinator {
  private current: TeamRun | null = null;
  private past: TeamRun[] = [];
  error?: string;
  private busy = false;
  constructor(private file: string, readonly presets: TeamPresets, private io: TeamAdapter) {
    try {
      const stored = restored(load(file, { current: null, past: [] })); this.current = stored.current; this.past = stored.past;
      if (this.current && ['starting','running','paused'].includes(this.current.phase)) {
        const r=this.current, roster=this.io.list().filter(w=>w.masterWorkers?.id===r.id);
        r.masterId ??= roster.find(w=>w.masterWorkers?.role==='master')?.id;
        r.masterWorktree ??= roster.find(w=>w.id===r.masterId)?.worktree;
        for(const w of roster.filter(w=>w.masterWorkers?.role==='worker')) {
          const a=r.tasks.find(t=>t.id===w.masterWorkers?.task)?.attempts.at(-1);
          if(a&&!a.workerId){a.workerId=w.id;if(!r.workers.some(p=>p.workerId===w.id))r.workers.push({workerId:w.id,choice:a.choice});}
        }
        this.current.phase = 'paused'; this.current.error = 'Office restarted: resume to reconcile team state'; this.persist();
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
    const req = request(raw);
    if (this.current) this.past = [...this.past, this.current].slice(-10);
    const r: TeamRun = { ...req, id: randomUUID(), owner, createdAt: Date.now(), revision: 0, phase: 'starting', workers: [], tasks: [], notifications: {} };
    this.current = r; this.persist();
    try {
      const master = this.io.spawn(req.master, masterPrompt(r), owner, undefined, {id:r.id,role:'master'});
      r.masterId = master.id; r.masterWorktree = master.worktree; r.phase = 'running'; this.update();
    } catch (e) { r.phase = 'paused'; r.error = (e as Error).message; this.update(); }
  }
  control(action: 'pause' | 'resume' | 'stop', owner?: string) {
    const r = this.current;
    if (this.busy) throw Error('Another team operation is in progress; retry control shortly');
    if (!r) throw Error('No team activity');
    if (r.owner && r.owner !== owner) throw Error('Only the activity owner can control this team');
    if (action === 'stop') {
      if (r.phase !== 'done') r.phase = 'stopped'; this.snapshot(); this.update();
      for (const id of [r.masterId, ...r.workers.map(w => w.workerId)]) if (id) this.io.stop(id);
      return;
    }
    if (['done','stopped'].includes(r.phase)) throw Error('This activity has ended');
    if (action === 'pause') { r.phase = 'paused'; this.update(); return; }
    if (!r.masterId) {
      const master = this.io.spawn(r.master, masterPrompt(r), r.owner, undefined, {id:r.id,role:'master'});
      r.masterId = master.id; r.masterWorktree = master.worktree;
    }
    this.io.head(r.masterId,true); // Preserve partial work while reconciling interrupted runs.
    r.phase = 'running'; delete r.error;
    r.notifications[r.masterId] = `Resume activity ${r.id}. Read team_state and inbox, reconcile existing commits and accepted tasks; do not duplicate work or PRs.`;
    this.update();
    const list=this.io.list();
    const master=list.find(w=>w.id===r.masterId);
    if(master&&['offline','exited'].includes(master.status)){
      const prompt=r.notifications[r.masterId];delete r.notifications[r.masterId];this.update();
      const error=this.io.prompt(r.masterId,prompt);if(error){r.phase='paused';r.error=error;this.update();}
    }
    if(r.phase==='running')for(const t of r.tasks){
      const a=t.attempts.at(-1),w=list.find(w=>w.id===a?.workerId);
      if(t.status==='running'&&a&&w&&['offline','exited'].includes(w.status)){
        const error=this.io.prompt(w.id,workerPrompt(r,t)+'\nResume existing work; inspect your branch and avoid duplicate commits.');
        if(error){a.status='failed';a.summary=error;t.status='pending';this.notify(r,`task ${t.id} could not resume`);this.update();}
      }
    }
  }
  private run(actor: string, b: TeamAction): TeamRun {
    const r = this.current;
    if (this.error) throw Error(this.error);
    if (!r || !this.member(actor) || b.id !== r.id) throw Error('Not a participant in this activity');
    if (r.phase !== 'running' && !(r.phase === 'paused' && b.action === 'result')) throw Error(`Team is ${r.phase}; resume it before making changes`);
    if (b.revision !== r.revision) throw Error('Stale activity revision: read team_state and retry without repeating completed work');
    return r;
  }
  private task(r: TeamRun, id: string) { const t = r.tasks.find(t => t.id === id); if (!t) throw Error('Unknown task'); return t; }
  private ready(r: TeamRun, t: TeamTask) {
    if (!t.dependencies.every(id => this.task(r,id).status === 'done')) throw Error('Task dependencies are not integrated');
  }
  private notify(r: TeamRun, message: string) { if (r.masterId) r.notifications[r.masterId] = `Team update: ${message}. Read team_state and inbox. Review results, integrate accepted work, dispatch ready tasks, or finish your own work. Preserve completed work.`; }
  async action(actor: string, b: TeamAction) {
    if (this.busy) throw Error('Another team operation is in progress; read state and retry');
    this.busy = true;
    try {
      const r = this.run(actor,b);
      if (b.action !== 'result' && actor !== r.masterId) throw Error('Only the master can plan, dispatch, review, take over or finish');
      switch (b.action) {
        case 'plan': {
          const plan = text(b.plan,'plan',60000);
          if (!Array.isArray(b.tasks) || !b.tasks.length || b.tasks.length > 100) throw Error('Provide 1–100 tasks');
          const tasks: TeamTask[] = b.tasks.map(t => {
            const id = text(t.id,'task ID',80);
            if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('Task IDs use letters, digits, underscores or hyphens');
            if (!Array.isArray(t.files) || !Array.isArray(t.dependencies) || t.files.length > 100 || t.dependencies.length > 100) throw Error('Provide file and dependency arrays');
            const old = r.tasks.find(v => v.id === id);
            if (old && old.status !== 'pending') {
              if (JSON.stringify([old.title,old.instructions,old.acceptance,old.files,old.dependencies]) !== JSON.stringify([t.title,t.instructions,t.acceptance,t.files,t.dependencies])) throw Error('Started task definitions cannot be changed');
              return old;
            }
            return { id, title: text(t.title,'title',240), instructions:text(t.instructions,'instructions'), acceptance:text(t.acceptance,'acceptance'), files:t.files.map(f=>text(f,'file',500)), dependencies:t.dependencies.map(d=>text(d,'dependency',80)), status:'pending', attempts:[] };
          });
          if (new Set(tasks.map(t=>t.id)).size !== tasks.length || r.tasks.some(t=>t.status !== 'pending' && !tasks.some(v=>v.id===t.id))) throw Error('Keep started tasks and unique IDs');
          const visited = new Set<string>(), visiting = new Set<string>();
          const walk = (id: string) => { if (visiting.has(id)) throw Error('Cyclic dependencies'); if (visited.has(id)) return; const t = tasks.find(v=>v.id===id); if (!t) throw Error('Unknown dependency'); visiting.add(id); t.dependencies.forEach(walk); visiting.delete(id); visited.add(id); };
          tasks.forEach(t=>walk(t.id)); r.tasks = tasks; r.plan = plan; break;
        }
        case 'dispatch': {
          if (!r.plan) throw Error('Publish a plan first');
          const t = this.task(r,b.task); this.ready(r,t);
          if (['done','running','review','takeover'].includes(t.status)) throw Error('Task cannot be dispatched in its current state');
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
          const pending: TeamAttempt = {workerId:'',choice:selected,base,status:'running'};
          t.status = 'running'; t.reason = reason; t.attempts.push(pending); this.update();
          try {
            if (worker) {
              pending.workerId = worker.id; this.update();
              const err = this.io.prompt(worker.id, workerPrompt(r,t)); if (err) throw Error(err);
            } else {
              worker = this.io.spawn(selected,workerPrompt(r,t),r.owner,{commit:base,from:r.masterWorktree!.branch},{id:r.id,role:'worker',task:t.id});
              pending.workerId = worker.id; r.workers.push({workerId:worker.id,choice:selected});
            }
          } catch (e) { pending.status = 'failed'; pending.summary = (e as Error).message; t.status = 'pending'; this.notify(r,`task ${t.id} could not launch`); this.update(); throw e; }
          break;
        }
        case 'result': {
          const t = this.task(r,b.task), a = t.attempts.at(-1);
          if (!a || a.workerId !== actor || a.status !== 'running' || t.status !== 'running') throw Error('No running assignment for this worker');
          const summary=text(b.summary,'result summary'), checks=text(b.checks,'checks and evidence');
          if (!Array.isArray(b.commits) || b.commits.length > 100) throw Error('Provide at most 100 commit IDs');
          if (b.failed !== undefined && typeof b.failed !== 'boolean') throw Error('failed must be a boolean');
          const commits=this.io.commits(actor,a.base,b.commits,b.failed);
          a.summary=summary; a.checks=checks; a.commits=commits; a.status=b.failed?'failed':'submitted'; t.status=b.failed?'pending':'review';
          this.snapshot(); this.notify(r,`task ${t.id} ${b.failed?'failed':'has a result to review'}`); break;
        }
        case 'cancel': {
          const t=this.task(r,b.task),a=t.attempts.at(-1);
          if(t.status!=='running'||!a)throw Error('No running assignment to cancel');
          const evidence=text(b.evidence,'cancellation evidence');this.snapshot();this.io.stop(a.workerId);
          a.status='failed';a.summary=evidence;t.status='pending';break;
        }
        case 'review': {
          const t=this.task(r,b.task), a=t.attempts.at(-1);
          if (t.status!=='review' || a?.status!=='submitted') throw Error('No submitted result to review');
          const evidence=text(b.evidence,'review evidence');
          if (b.accept !== true && b.accept !== false) throw Error('Provide accept:true or false');
          if (b.accept) this.io.head(actor);
          if (b.accept && !this.io.contains(actor,a.commits??[])) throw Error('Integrate submitted commits into the master branch before acceptance');
          a.review=evidence; a.status=b.accept?'accepted':'rejected'; t.status=b.accept?'done':'pending';
          if (b.accept) { t.integrated=a.commits; t.evidence=evidence; } break;
        }
        case 'takeover': {
          const t=this.task(r,b.task); this.ready(r,t);
          if (t.status==='done' || ['running','review'].includes(t.status)) throw Error('Resolve active worker result before taking over');
          const evidence=text(b.evidence,'master takeover evidence');
          if(b.complete !== undefined && typeof b.complete !== 'boolean') throw Error('complete must be a boolean');
          if(b.complete) this.io.head(actor);
          t.evidence=evidence; t.status=b.complete?'done':'takeover'; break;
        }
        case 'finish': {
          if (!r.plan || !r.tasks.length || r.tasks.some(t=>t.status!=='done')) throw Error('Finish every task first');
          const summary=text(b.summary,'completion summary'), checks=text(b.checks,'final verification evidence'), pr=text(b.pr,'PR URL',1000);
          await this.io.verifyPr(actor,pr);
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
      if (!master || ['offline','exited'].includes(master.status)) { r.phase='paused'; r.error='Master is unavailable; resume after checking its terminal and checkout'; this.snapshot(); this.update(); return; }
      let changed=false;
      for (const t of r.tasks) {
        const a=t.attempts.at(-1); if(t.status!=='running' || !a) continue;
        const w=list.find(v=>v.id===a.workerId);
        if(w?.status==='needs_input' && a.notice!=='needs_input'){a.notice='needs_input';this.notify(r,`task ${t.id} needs input; inspect its blocker, cancel/retry or take over if appropriate`);changed=true;}
        else if(w&&w.status!=='needs_input'&&a.notice){delete a.notice;changed=true;}
        if (!w || ['offline','exited','done'].includes(w.status)) {
          a.status='failed'; a.summary='Worker stopped without submitting a result; inspect and preserve its work'; t.status='pending'; this.notify(r,`task ${t.id} stopped without a result`); changed=true;
        }
      }
      for (const [id,message] of Object.entries(r.notifications)) {
        const w=list.find(v=>v.id===id);
        if (!w || !['idle','done'].includes(w.status)) continue;
        delete r.notifications[id]; this.update(); // delivery intent saved before sending
        const err=this.io.prompt(id,message);
        if(err) { r.notifications[id]=message; r.error=err; changed=true; }
      }
      if(changed) { this.snapshot(); this.update(); }
    } catch(e) { r.phase='paused'; r.error=(e as Error).message; this.update(); }
    finally { this.busy=false; }
  }
}
