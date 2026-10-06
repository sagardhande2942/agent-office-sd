import './plan-review.css';
import { PLAN_CRITERIA, DEFAULT_PLAN_WEIGHTS } from '../../shared/plan-review';
import type { AgentChoice } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, toast } from './dom';

/** The same activity controls in the 3D and lite offices. */
export function openPlanReview(net:Net, openWorker:(id:string)=>void) {
  const close=h('button.btn.close',{'aria-label':'Close'},'✕');
  const body=h('div.body.plan-comparison');
  const el=h('div.modal.meeting-window',{role:'dialog','aria-label':'Plan comparison'},h('header',{},h('h2',{},'Plan comparison'),close),body);
  let formView=!store.planReview.current;
  const expanded=new Set<string>();
  const detail=(key:string,label:string,...children:HTMLElement[])=>{const el=h('details',{...(expanded.has(key)?{open:true}:{})},h('summary',{},label),...children);el.addEventListener('toggle',()=>{if((el as HTMLDetailsElement).open)expanded.add(key);else expanded.delete(key);});return el;};
  const render=()=>{
    const m=store.planReview.current;
    if(formView||!m){showForm();return;}
    body.replaceChildren(h('p',{},`${m.phase} · ${m.candidates.length} candidates + one reviewer`),h('p',{},m.brief));
    body.append(h('ol',{},...m.requirements.map(r=>h('li',{},r))));
    if(m.error) body.append(h('p.error',{role:'alert'},m.error));
    body.append(h('p.muted',{},'Weights: '+PLAN_CRITERIA.map(c=>`${c.label} ${m.weights[c.id]}%`).join(' · ')));
    if(m.review) body.append(h('h3',{},m.review.winner?`Accepted: Candidate ${m.review.winner}`:'No eligible plan'),h('p',{},m.review.summary));
    for(const c of m.candidates){
      const rating=m.review?.ratings.find(r=>r.candidate===c.id);
      const card=h('section.communication-card',{},h('h3',{},`Candidate ${c.id} · ${c.choice.provider}/${c.choice.model}`),h('p',{},rating?`${rating.decision} · ${rating.score}/100 · ${rating.eligible?'eligible':'failed eligibility gates'}`:c.clarification?'Clarification requested':c.plan?'Plan submitted':'Planning'));
      if(rating){card.append(h('p',{},rating.reason),detail(c.id+'rating','Criterion scores and evidence',h('ul',{},...PLAN_CRITERIA.map(k=>h('li',{},`${k.label}: ${rating.scores[k.id]}/10 — ${rating.scoreReasons[k.id]}`))),h('p',{},Object.entries(rating.gates).map(([k,g])=>`${k}: ${g.pass?'pass':'fail'} — ${g.reason}`).join('\n')),h('p',{},'Strengths: '+rating.strengths.join('; ')),h('p',{},'Weaknesses: '+rating.weaknesses.join('; '))));}
      const worker=store.workers.get(c.workerId);
      if(worker)card.append(h('p.muted',{},`Terminal: ${worker.status}${['offline','exited'].includes(worker.status)?' — resume from its terminal':''}`));
      if(c.clarification) card.append(h('p',{},c.clarification));
      if(c.plan) card.append(detail(c.id+'plan','Read detailed plan',h('pre',{},JSON.stringify(c.plan,null,2))));
      if(c.previousPlan) card.append(detail(c.id+'original','Original plan before clarification',h('pre',{},JSON.stringify(c.previousPlan,null,2))));
      if(c.cleanup) card.append(h('p',{},c.cleanup.done?'Worker sent home; worktree and branch cleaned':`Cleanup needs attention: ${c.cleanup.error}`));
      if(store.workers.has(c.workerId)) card.append(h('button.btn',{onclick:()=>{modal.close();openWorker(c.workerId);}},'Open terminal'));
      body.append(card);
    }
    if(store.workers.has(m.reviewer.workerId)) body.append(h('button.btn',{onclick:()=>{modal.close();openWorker(m.reviewer.workerId);}},'Reviewer terminal'));
    if(m.phase==='cleanup') body.append(h('button.btn',{onclick:()=>net.send({t:'plan-review.retry'})},'Retry cleanup'));
    body.append(h('button.btn',{onclick:()=>net.send({t:'plan-review.stop'})},m.implementationStarted?'Close activity (keep winning work)':'Stop and clean activity'));
    if(['done','no-winner','error','stopped'].includes(m.phase)) body.append(h('button.btn',{onclick:()=>{formView=true;render();}},'New comparison'));
    if(store.planReview.past.length) body.append(h('details',{},h('summary',{},'Previous comparisons'),...store.planReview.past.map(p=>h('section',{},h('h3',{},p.brief),h('p',{},`${p.phase} · accepted ${p.review?.winner??'none'}`),h('p',{},p.review?.summary??p.error??''),...(p.review?.ratings??[]).map(r=>h('p',{},`${r.candidate}: ${r.decision} (${r.score}/100) — ${r.reason}`))))));
  };
  const showForm=()=>{
    const brief=h('textarea',{rows:3,required:true,'aria-label':'Task brief',placeholder:'Describe the task to plan'}) as HTMLTextAreaElement;
    const requirements=h('textarea',{rows:5,required:true,'aria-label':'Requirements',placeholder:'One requirement per line'}) as HTMLTextAreaElement;
    const constraints=h('textarea',{rows:2,'aria-label':'Constraints',placeholder:'Constraints and explicit exclusions'}) as HTMLTextAreaElement;
    const choices=h('div'); const rows:{el:HTMLElement;read:()=>AgentChoice}[]=[];
    const choice=(reviewer=false)=>{
      const provider=h('select',{'aria-label':reviewer?'Reviewer provider':'Candidate provider'},h('option',{value:'claude'},'Claude Code'),h('option',{value:'opencode'},'OpenCode 1.x')) as HTMLSelectElement;
      const model=h('input',{type:'text',required:true,'aria-label':reviewer?'Reviewer model':'Candidate model',placeholder:'sonnet or provider/model',value:reviewer?'opus':rows.length===0?'sonnet':'haiku'}) as HTMLInputElement;
      const el=h('div.plan-model-row',{},provider,model);
      if(!reviewer) el.append(h('button.btn',{type:'button',onclick:()=>{if(rows.length===1)return;const i=rows.findIndex(r=>r.el===el);rows.splice(i,1);el.remove();}},'Remove'));
      return {el,read:()=>({provider:provider.value as AgentChoice['provider'],model:model.value.trim()})};
    };
    const add=()=>{if(rows.length>=5)return;const row=choice();rows.push(row);choices.append(row.el);};add();add();
    const reviewer=choice(true);
    const minutes=h('input',{type:'number',min:1,max:120,value:20,'aria-label':'Minutes per round'}) as HTMLInputElement;
    const weights=new Map<string,HTMLInputElement>();
    const rubric=h('div',{},...PLAN_CRITERIA.map(c=>{const input=h('input',{type:'number',min:0,max:100,value:DEFAULT_PLAN_WEIGHTS[c.id],'aria-label':`${c.label} weight`}) as HTMLInputElement;weights.set(c.id,input);return h('label',{},c.label,input);}));
    const form=h('form',{},h('p',{},'Up to five independent models plan the same requirements. One reviewer scores plans, explains every decision, and the highest-rated eligible worker implements. Rejected workers are sent home with their worktrees and branches removed.'),h('label',{},'Task brief',brief),h('label',{},'Requirements (one per line)',requirements),h('label',{},'Constraints',constraints),h('h3',{},'Planning models'),choices,h('button.btn',{type:'button',onclick:add},'Add candidate (maximum 5)'),h('p.muted',{},'Choose distinct model IDs. Claude aliases: sonnet, haiku, opus, fable. OpenCode 1.x accepts provider/model. These sessions allow reads and plan tools; implementation begins in a fresh conversation for the winner.'),h('h3',{},'Reviewer model'),reviewer.el,h('h3',{},'Fixed review criteria (weights total 100)'),rubric,h('label',{},'Minutes per planning/review round',minutes),h('button.btn.primary',{type:'submit'},'Start plan comparison'));
    form.addEventListener('submit',e=>{e.preventDefault();const reqs=requirements.value.split('\n').map(s=>s.trim()).filter(Boolean);if(!reqs.length||brief.value.trim().length<10){toast('Provide a task brief and requirements','error');return;}const w=Object.fromEntries([...weights].map(([k,v])=>[k,Number(v.value)])) as typeof DEFAULT_PLAN_WEIGHTS;if(Object.values(w).reduce((a,b)=>a+b,0)!==100){toast('Weights must total 100','error');return;}net.send({t:'plan-review.start',request:{brief:brief.value.trim(),requirements:reqs,constraints:constraints.value.trim(),candidates:rows.map(r=>r.read()),reviewer:reviewer.read(),weights:w,minutes:Number(minutes.value)}});formView=false;});
    body.replaceChildren(form);
    if(store.planReview.error) body.prepend(h('p.error',{role:'alert'},store.planReview.error));
    if(store.planReview.current) body.append(h('button.btn',{onclick:()=>{formView=false;render();}},'Back to current comparison'));
  };
  const offs=[store.on('planReview',render),store.on('workers',()=>{if(!formView)render();})];
  const modal=openModal(el,{doing:'at the plan comparison table',onClose:()=>offs.forEach(off=>off())});
  close.addEventListener('click',()=>modal.close());render();return modal;
}
