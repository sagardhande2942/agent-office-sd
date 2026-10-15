import { taskCoordination, coordinationMetrics } from '../team-coordination';
import type { BossControl,BossState,BossItem } from '../../../shared/boss-mode/types';
import { BOSS_CATEGORIES } from '../../../shared/boss-mode/types';
import { h } from '../../ui/dom';
import { store } from '../../state';
import { fmtTokens,fmtCost,tokensOf } from '../../../shared/protocol';
import { safePrUrl } from '../../ui/task-replay';
export const BOSS_TABS=['Overview','Roadmap','Work','Delivery','History','Settings'] as const;
export type BossTab=typeof BOSS_TABS[number];
export interface ViewActions {control(c:BossControl):void;terminal(id:string):void;tab(t:BossTab):void;}
const section=(title:string,...nodes:(HTMLElement|string)[])=>h('section.boss-section',{},h('h3',{},title),...nodes);
const empty=(text:string)=>h('p.boss-empty',{},text);
const link=(url:string)=>{const safe=safePrUrl(url);return safe?h('a.btn',{href:safe,target:'_blank',rel:'noopener noreferrer'},'Open PR'):h('span',{},'PR link unavailable');};
function idea(item:BossItem,actions:ViewActions){
  const card=section(item.title,h('span.boss-badge',{},item.status+' · '+item.category+' · priority '+item.priority),h('p',{},item.problem),h('p.muted',{},item.benefit),h('details',{},h('summary',{},'Evidence and acceptance'),h('pre',{},item.evidence),h('ul',{},...item.acceptance.map(v=>h('li',{},v))),h('p',{},'Dependencies: '+(item.dependencies.join(', ')||'none'))));
  if(item.error)card.append(h('p.boss-error',{},item.error));if(item.pr)card.append(link(item.pr));
  if(store.me.admin&&['suggested','queued','blocked'].includes(item.status))card.append(h('div.boss-actions',{},h('button.btn',{onclick:()=>actions.control({action:'prioritize',id:item.id,priority:Math.min(100,item.priority+10)})},'Raise priority'),h('button.btn',{onclick:()=>actions.control({action:'reject',id:item.id})},'Reject')));
  return card;
}
export function renderBossView(tab:BossTab,state:BossState,actions:ViewActions):HTMLElement {
  const page=h('div.boss-page'),run=state.team?.current??state.backlog.find(i=>i.id===state.active)?.run;
  if(tab==='Overview'){
    const cards:[string,string,BossTab][]=[['Task progress',run?run.tasks.filter(t=>t.status==='done').length+' / '+run.tasks.filter(t=>t.status!=='superseded').length:'No active initiative','Work'],['Workers',run?run.workers.filter(w=>store.workers.has(w.workerId)).length+' / '+state.config.maxWorkers:'0 / '+state.config.maxWorkers,'Work'],['Daily starts',state.starts+' / '+state.config.dailyStarts,'Settings'],['Outstanding PRs',String(state.backlog.filter(i=>i.pr&&!i.merged&&store.pulls.items.some(p=>p.url===i.pr&&p.state==='OPEN')).length),'Delivery']];
    page.append(h('div.boss-hero',{},h('span.boss-eyebrow',{},'CONTINUOUS ENGINEERING'),h('h2',{},state.message),h('p',{},state.config.mission||'Set a mission and configure your team to begin.')),h('div.boss-metrics',{},...cards.map(([title,value,next])=>h('button.boss-metric',{onclick:()=>actions.tab(next)},h('span',{},title),h('strong',{},value)))),section('Current initiative',run?h('p',{},run.brief):empty('The boss will choose useful work aligned with your mission.')));
    const ids=new Set([run?.masterId,...(run?.workers.map(w=>w.workerId)??[]),state.discovery?.workerId]);
    const workers=[...store.workers.values()].filter(w=>w.bossMode||ids.has(w.id)),usage=workers.flatMap(w=>w.usage?[w.usage]:[]);
    page.append(section('Reported usage',h('p',{},fmtTokens(usage.reduce((n,u)=>n+tokensOf(u),0))+' tokens · '+(usage.some(u=>u.costKnown===false)?'cost partially unavailable':fmtCost(usage.reduce((n,u)=>n+u.cost,0)))+' · '+(usage.some(u=>u.incomplete)?'partial provider data':'reported provider data'))),section('Latest decision',h('p',{},state.events.at(-1)?.message??'No decisions yet.')));
    const blockers=state.backlog.filter(i=>i.status==='blocked');if(blockers.length)page.append(section('Needs attention',...blockers.map(i=>h('p.boss-error',{},i.title+': '+i.error))));
  }else if(tab==='Roadmap'){
    if(store.me.admin){const title=h('input',{placeholder:'Feature or improvement','aria-label':'Idea title',required:true,maxlength:240}),problem=h('textarea',{placeholder:'What problem would this solve?','aria-label':'Idea problem',required:true,maxlength:4000}),category=h('select',{'aria-label':'Idea category'},...BOSS_CATEGORIES.map(c=>h('option',{value:c},c))),form=h('form.boss-idea',{},title,problem,category,h('button.btn.primary',{type:'submit'},'Add idea'));
      form.addEventListener('submit',e=>{e.preventDefault();actions.control({action:'idea',title:title.value,problem:problem.value,category:category.value as BossItem['category']});title.value='';problem.value='';});page.append(section('Give the boss an idea',form));}
    page.append(...[...state.backlog].sort((a,b)=>b.priority-a.priority).map(i=>idea(i,actions)));if(!state.backlog.length)page.append(empty('No initiatives yet. The boss researches opportunities when enabled.'));
  }else if(tab==='Work'){
    if(store.me.admin)page.append(h('button.btn.danger',{onclick:()=>actions.control({action:'stop-now'})},'Stop now—keep work'));
    page.append(section('Boss activity',h('p',{},state.presence?.activity??state.message)));
    const master=run?.masterId??state.discovery?.workerId;if(master)page.append(h('button.btn',{disabled:!store.workers.has(master),onclick:()=>actions.terminal(master)},'Open boss terminal'));
    if(run)page.append(coordinationMetrics(run),section('Master usage',h('p',{},(()=>{const u=store.workers.get(run.masterId??'')?.usage??run.masterUsage;return u?fmtTokens(tokensOf(u))+' tokens · '+(u.costKnown===false?'cost unavailable':fmtCost(u.cost))+(u.incomplete?' (partial)':''):'Usage unavailable';})())));
    if(run?.plan)page.append(section('Execution plan',h('pre',{},run.plan)));
    if(run?.tasks.length)page.append(section('Task dependencies',h('div.boss-dependency-map',{},...run.tasks.map(task=>h('div.boss-dependency-node',{},h('a',{href:'#boss-task-'+task.id},task.title),h('span.boss-badge',{},task.status),h('p.muted',{},task.dependencies.length?'After: '+task.dependencies.map(id=>run.tasks.find(t=>t.id===id)?.title??id).join(' → '):'Ready independently'))))));
    for(const task of run?.tasks??[]){const card=section(task.title,h('span.boss-badge',{},task.status),h('p',{},task.acceptance),h('p.muted',{},'Depends on: '+(task.dependencies.join(' → ')||'none')),h('details',{},h('summary',{},'Assignment'),h('pre',{},task.instructions)));
      card.id='boss-task-'+task.id;card.append(taskCoordination(task,run!.phase));
      for(const attempt of task.attempts){card.append(h('div.boss-assignment',{},h('strong',{},attempt.choice.provider+' / '+(attempt.choice.model??'default')+(attempt.choice.effort?' · '+attempt.choice.effort:'')),h('p',{},attempt.status+' · '+(attempt.summary??'Working')),h('pre',{},attempt.review??attempt.checks??''),h('button.btn',{disabled:!store.workers.has(attempt.workerId),onclick:()=>actions.terminal(attempt.workerId)},'Worker terminal')));}page.append(card);}
    if(!run?.tasks.length)page.append(empty('Planning and assignments appear here when work starts.'));
  }else if(tab==='Delivery'){
    page.append(section('Delivery policy',h('p',{},state.config.delivery==='pr'?'Open ready PRs; repository merging remains separate.':'Squash merge only with successful CI, approval, required label, and repository-rule eligibility.')));
    for(const item of state.backlog.filter(i=>i.pr))page.append(section(item.title,link(item.pr!),h('p',{},item.merged?'Merged':item.followup??'Delivered; monitoring CI and reviews.')));
    for(const check of [...state.checks].reverse())page.append(section(check.command,h('span.boss-badge',{},check.finishedAt?(check.exitCode===0?'Passed':'Failed'):'Running'),h('p.muted',{},'Commit '+check.commit),h('details',{},h('summary',{},'Verification log'),h('pre',{},check.log||'No output.'))));
    if(!state.checks.length)page.append(empty('Independent verification evidence appears here.'));
  }else if(tab==='History'){
    const filter=h('input',{placeholder:'Filter decisions or initiatives','aria-label':'History filter'}),list=h('div');
    const draw=()=>list.replaceChildren(...[...state.events].reverse().filter(e=>(e.kind+' '+e.message+' '+(e.initiative??'')).toLowerCase().includes(filter.value.toLowerCase())).map(e=>section(e.kind,h('time',{},new Date(e.at).toLocaleString()),h('p',{},e.message))));filter.addEventListener('input',draw);draw();
    page.append(h('div.boss-actions',{},filter,h('button.btn',{onclick:()=>{const lines=['# Boss Office report','',state.config.mission,'',...state.events.map(e=>new Date(e.at).toISOString()+' · '+e.kind+' · '+e.message.replace(/[\r\n]/g,' '))];const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown'}));const a=h('a',{href:url,download:'boss-office-report.md'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}},'Export report')),list);
  }
  return page;
}
