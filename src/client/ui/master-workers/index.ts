import './style.css';
import type { Net } from '../../net';
import type { AgentChoice } from '../../../shared/protocol';
import type { TeamPreset, TeamRequest } from '../../../shared/master-workers';
import { planProviders } from '../../../shared/plan-providers';
import { fmtCost, tokensOf, fmtTokens } from '../../../shared/protocol';
import { store } from '../../state';
import { h, openModal, toast } from '../dom';
import { agentFields } from '../provider';
import { openTaskReplay, safePrUrl } from '../task-replay';
import type { TeamRun } from '../../../shared/master-workers';
export function openMasterWorkers(net:Net,openWorker:(id:string)=>void) {
  const close=h('button.btn.close',{'aria-label':'Close'},'✕'),body=h('div.body.team-mode');
  const el=h('div.modal.team-window',{role:'dialog','aria-label':'Master / Workers'},h('header',{},h('h2',{},'Master / Workers'),close),body);
  const providers=planProviders(store.project?.agentProviders??[]);
  const fallback:AgentChoice={provider:providers[0]??'claude'};
  let draft:TeamRequest={master:fallback,models:[fallback],maxWorkers:5,brief:'',requirements:[],constraints:''};
  let presetId='',presetName='',formView=!store.masterWorkers.current,sequence=0;
  let capture=()=>{};
  const expanded=new Set<string>(['plan']);
  const details=(key:string,label:string,...children:HTMLElement[])=>{const el=h('details',{open:expanded.has(key)},h('summary',{},label),...children);el.addEventListener('toggle',()=>{if(el.open)expanded.add(key);else expanded.delete(key);});return el;};
  const control=(action:'pause'|'resume'|'stop')=>net.send({t:'master-workers.control',action});
  const model=(initial:AgentChoice,label:string)=>{
    const project=store.project?{...store.project,agentProviders:providers}:null;
    const fields=agentFields(project,`team-model-${sequence++}`,initial,'Provider',true,'team participant');
    fields.element.querySelector('select')!.setAttribute('aria-label',`${label} provider`);
    return {el:h('div.team-model',{},h('strong',{},label),fields.element),read:fields.choice,valid:()=>fields.valid()&&!!fields.model()};
  };
  const replayButton=(run:TeamRun)=>h('button.btn',{type:'button',onclick:()=>{modal.close();openTaskReplay(run);}},'Replay');
  const pastActivities=()=>h('details',{},h('summary',{},'Previous activities'),...store.masterWorkers.past.map(p=>h('section',{},h('strong',{},p.brief),h('p',{},p.phase),replayButton(p),...(safePrUrl(p.pr)?[h('a',{href:safePrUrl(p.pr),target:'_blank',rel:'noopener noreferrer'},'Open PR')]:[]))));
  const renderForm=()=>{
    const saved=store.masterWorkers.presets;
    const select=h('select',{'aria-label':'Team preset'},h('option',{value:''},'Choose a saved preset'),...saved.map(p=>h('option',{value:p.id},p.name))) as HTMLSelectElement;
    select.value=presetId;
    const name=h('input',{type:'text',value:presetName,placeholder:'Preset name','aria-label':'Preset name',maxlength:100}) as HTMLInputElement;
    const brief=h('textarea',{rows:3,value:draft.brief,'aria-label':'Task brief',placeholder:'What should the master get done?'}) as HTMLTextAreaElement;
    const requirements=h('textarea',{rows:4,value:draft.requirements.join('\n'),'aria-label':'Requirements',placeholder:'One requirement per line'}) as HTMLTextAreaElement;
    const constraints=h('textarea',{rows:2,'aria-label':'Constraints',placeholder:'Constraints and exclusions'}) as HTMLTextAreaElement;
    brief.value=draft.brief;requirements.value=draft.requirements.join('\n');constraints.value=draft.constraints??'';
    const master=model(draft.master,'Master'),pool=h('div.team-pool');
    const rows:ReturnType<typeof model>[]=[];
    const add=(a:AgentChoice)=>{if(rows.length>=20)return;const row=model(a,`Eligible model ${rows.length+1}`);rows.push(row);row.el.append(h('button.btn',{type:'button',onclick:()=>{if(rows.length<2)return;rows.splice(rows.indexOf(row),1);row.el.remove();}},'Remove'));pool.append(row.el);};
    draft.models.forEach(add);
    const limit=h('input',{type:'number',min:1,max:5,value:draft.maxWorkers,'aria-label':'Maximum workers'}) as HTMLInputElement;
    capture=()=>{draft={master:master.read(),models:rows.map(r=>r.read()),maxWorkers:Number(limit.value),brief:brief.value,requirements:requirements.value.split('\n').map(s=>s.trim()).filter(Boolean),constraints:constraints.value};presetName=name.value;};
    const valid=()=>{capture();if(!master.valid()||!rows.every(r=>r.valid())){toast('Choose explicit models for the master and every eligible worker','error');return false;}return true;};
    const savePreset=(duplicate=false)=>{
      if(!valid())return;if(!presetName.trim()){toast('Give the preset a name','error');return;}
      presetId=duplicate||!presetId?crypto.randomUUID():presetId;
      const {master,models,maxWorkers}=draft;
      const preset:TeamPreset={id:presetId,name:presetName.trim(),master,models,maxWorkers};net.send({t:'master-workers.preset',preset});
    };
    select.addEventListener('change',()=>{capture();const p=saved.find(p=>p.id===select.value);presetId=p?.id??'';if(p){presetName=p.name;draft={...draft,master:p.master,models:p.models,maxWorkers:p.maxWorkers};}render();});
    const form=h('form',{},h('p',{},'One master plans, delegates to models you allow, reviews their work, and delivers one verified PR. Up to five workers can help; the master also contributes.'),h('section.team-presets',{},h('h3',{},'Reusable team preset'),select,name,h('div.team-buttons',{},h('button.btn',{type:'button',onclick:()=>savePreset()},'Save preset'),h('button.btn',{type:'button',onclick:()=>savePreset(true)},'Save as new'),h('button.btn',{type:'button',disabled:!presetId,onclick:()=>{capture();net.send({t:'master-workers.preset',remove:presetId});presetId='';presetName='';}},'Delete preset'))),master.el,h('h3',{},'Eligible worker models'),h('p.muted',{},'The master chooses suitable models for each task. Models can be reused; no capability notes are needed.'),pool,h('button.btn',{type:'button',onclick:()=>add(fallback)},'Add eligible model'),h('label',{},'Maximum workers (master is additional)',limit),h('label',{},'Task brief',brief),h('label',{},'Requirements',requirements),h('label',{},'Constraints',constraints),h('button.btn.primary',{type:'submit'},'Start Master / Workers'));
    form.addEventListener('submit',e=>{e.preventDefault();if(!valid())return;if(!draft.brief.trim()||!draft.requirements.length){toast('Provide a brief and requirements','error');return;}net.send({t:'master-workers.start',request:draft});formView=false;});
    body.replaceChildren(form);
    if(store.masterWorkers.past.length)body.append(pastActivities());
    if(store.masterWorkers.current)body.append(h('button.btn',{onclick:()=>{capture();formView=false;render();}},'Back to activity'));
  };
  const render=()=>{
    const state=store.masterWorkers,r=state.current;
    if(formView||!r){renderForm();if(state.error)body.prepend(h('p.error',{role:'alert'},state.error));return;}
    capture=()=>{};
    const terminal=(id:string,label:string)=>h('button.btn',{onclick:()=>{modal.close();openWorker(id);},disabled:!store.workers.has(id)},label);
    const usage=(id:string)=>{
      const u=store.workers.get(id)?.usage??(id===r.masterId?r.masterUsage:r.workers.find(w=>w.workerId===id)?.usage);
      return u?`${fmtTokens(tokensOf(u))} tokens · ${u.costKnown===false?'cost unavailable':fmtCost(u.cost)}${u.incomplete?' (partial)':''}`:'Usage unavailable';
    };
    body.replaceChildren(h('div.team-overview',{},h('strong',{},r.phase),h('span',{},`${r.workers.filter(w=>store.workers.has(w.workerId)).length} workers · limit ${r.maxWorkers}`)),h('h3',{},r.brief),h('ol',{},...r.requirements.map(v=>h('li',{},v))));
    if(r.error||state.error)body.append(h('p.error',{role:'alert'},r.error??state.error));
    if(r.masterId)body.append(h('section.team-card',{},h('h3',{},`Master · ${r.master.provider}/${r.master.model}`),h('p.muted',{},usage(r.masterId)),terminal(r.masterId,'Master terminal')));
    if(r.plan)body.append(details('plan','Master plan',h('pre',{},r.plan)));
    for(const t of r.tasks){
      const card=h('section.team-card',{},h('h3',{},`${t.title} · ${t.status}`),h('p',{},t.acceptance));
      if(t.dependencies.length)card.append(h('p.muted',{},'Depends on: '+t.dependencies.join(', ')));
      if(t.reason)card.append(h('p',{},'Model choice: '+t.reason));
      card.append(details(t.id+'-assignment','Assignment',h('pre',{},t.instructions),h('p',{},'Files: '+t.files.join(', '))));
      for(const a of t.attempts)card.append(details(t.id+'-'+a.workerId,`${a.choice.provider}/${a.choice.model} · ${a.status}`,h('p',{},a.summary??`Terminal: ${store.workers.get(a.workerId)?.status??'unavailable'}`),h('pre',{},a.checks??''),h('p',{},a.review??''),h('p.muted',{},a.commits?.join(', ')??''),...(a.workerId?[h('p.muted',{},usage(a.workerId)),terminal(a.workerId,'Worker terminal')]:[])));
      if(t.evidence)card.append(h('p',{},t.evidence));body.append(card);
    }
    if(!r.tasks.length)body.append(h('p.muted',{},'The master is inspecting the project and planning the work.'));
    if(r.pr)body.append(h('a.btn.primary',{href:r.pr,target:'_blank',rel:'noopener noreferrer'},'Open completed PR'),h('p',{},r.summary),h('pre',{},r.checks));
    const buttons=h('div.team-buttons',{},replayButton(r));
    if(!['done','stopped'].includes(r.phase)){buttons.append(h('button.btn',{onclick:()=>control(r.phase==='paused'?'resume':'pause')},r.phase==='paused'?'Resume':'Pause'),h('button.btn',{onclick:()=>control('stop')},'Stop (keep all work)'));body.append(h('p.muted',{},'Pause holds new orchestration; running assignments can still report results. Stop preserves all branches and worktrees.'));}
    else buttons.append(h('button.btn',{onclick:()=>control('stop')},'Close team terminals (keep work)'),h('button.btn',{onclick:()=>{formView=true;render();}},'New activity'));
    body.append(buttons);
    if(state.past.length)body.append(pastActivities());
  };
  const offs=[store.on('masterWorkers',()=>{if(formView)capture();render();}),store.on('workers',()=>{if(!formView)render();})];
  const modal=openModal(el,{doing:'managing a master and workers',onClose:()=>offs.forEach(off=>off())});
  close.addEventListener('click',()=>modal.close());render();return modal;
}
