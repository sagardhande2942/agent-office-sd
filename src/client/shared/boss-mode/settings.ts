import { BOSS_CATEGORIES,type BossConfig } from '../../../shared/boss-mode/types';
import { validateBossConfig } from '../../../shared/boss-mode/config';
import { h,toast } from '../../ui/dom';
import { agentFields } from '../../ui/provider';
import { store } from '../../state';
export function settingsForm(initial:BossConfig,save:(config:BossConfig)=>void,dirty:()=>void) {
  const config=structuredClone(initial),form=h('form.boss-settings');
  const field=(title:string,description:string,element:HTMLElement)=>h('label.boss-field',{},h('strong',{},title),h('span.muted',{},description),element);
  const section=(title:string,description:string,...elements:HTMLElement[])=>h('section.boss-section',{},h('h3',{},title),h('p.muted',{},description),...elements);
  const textarea=(value:string,label:string)=>{const el=h('textarea',{rows:3,'aria-label':label});el.value=value;return el;};
  const select=(value:string,choices:[string,string][],label:string)=>{const el=h('select',{'aria-label':label},...choices.map(([v,t])=>h('option',{value:v},t)));el.value=value;return el;};
  const number=(value:number,min:number,max:number,label:string)=>h('input',{type:'number',value,min,max,required:true,'aria-label':label});
  const mission=textarea(config.mission,'Mission'),constraints=textarea(config.constraints,'Constraints'),roadmap=textarea(config.roadmap,'Roadmap');
  const policy=select(config.initiativePolicy,[['roadmap','Roadmap-led'],['mission','Mission-led'],['explore','Broad exploration']],'Initiative selection');
  const categories=BOSS_CATEGORIES.map(category=>{const input=h('input',{type:'checkbox',checked:config.categories.includes(category),value:category});return {input,element:h('label.boss-check',{},input,category)};});
  const boss=agentFields(store.project,'boss-provider',config.boss,'Boss provider');
  const mode=select(config.workerMode,[['pool','Allowed model pool'],['slots','Explicit worker slots']],'Worker setup');
  const count=number(config.maxWorkers,1,10,'Maximum workers'),pool=h('div.boss-model-pool');
  const rows:ReturnType<typeof agentFields>[]=[];let serial=0;
  const add=(value=config.models[0])=>{if(rows.length>=20)return;const fields=agentFields(store.project,'boss-worker-'+serial++,value,'Worker provider');rows.push(fields);
    const row=h('div.boss-model-row',{},fields.element,h('button.btn',{type:'button','aria-label':'Remove worker model',onclick:()=>{if(rows.length===1)return;rows.splice(rows.indexOf(fields),1);row.remove();dirty();}},'Remove'));pool.append(row);};
  config.models.forEach(v=>add(v));
  const delivery=select(config.delivery,[['pr','Open ready PRs'],['merge','Policy-based squash merge']],'Delivery policy');
  const mergeLabel=h('input',{value:config.mergeLabel,'aria-label':'Required merge label'});
  const checks=textarea(config.checks.join('\n'),'Verification commands');
  const runtime=number(config.runtimeMinutes,5,1440,'Initiative runtime minutes'),daily=number(config.dailyStarts,1,1000,'Daily initiative starts');
  const recovery=number(config.recoveryAttempts,0,10,'Recovery attempts'),open=number(config.maxOpenPrs,1,100,'Outstanding PR limit'),interval=number(config.discoveryMinutes,1,1440,'Discovery interval minutes');
  const auto=h('input',{type:'checkbox',checked:config.autoRecover,'aria-label':'Recover after restart'});
  form.append(section('Product mission','Give the boss a direction it can pursue without asking you about every task.',field('Mission','What should this project become?',mission),field('Constraints and exclusions','Boundaries that every initiative must follow.',constraints),field('Roadmap','Features and priorities you already want.',roadmap)),
    section('Initiative selection','Choose how much initiative the boss may take.',policy,h('div.boss-categories',{},...categories.map(c=>c.element))),
    section('Boss agent','Choose its provider, model, and reasoning effort.',boss.element),
    section('Worker team','Up to 10 workers, plus the boss. Office capacity still applies. Slots can repeat a model; pools choose models dynamically.',mode,field('Maximum workers','Concurrent assignments, excluding the boss.',count),pool,h('button.btn',{type:'button',onclick:()=>{add();dirty();}},'Add model or slot')),
    section('Delivery and verification','The office runs these commands independently in the integration worktree. Configure trusted commands; each must succeed.',delivery,field('Required merge label','Merging also requires passing CI and approval. Repository rules take precedence.',mergeLabel),field('Verification commands','One shell command per line; run in the project worktree.',checks)),
    section('Operating limits','Limits bound unattended work. Daily initiative starts reset at midnight UTC.',h('div.boss-form-grid',{},field('Runtime, minutes','Maximum per initiative.',runtime),field('Daily starts','Maximum initiatives per UTC day.',daily),field('Recovery attempts','Retries before preserving blocked work.',recovery),field('Outstanding PRs','Wait when this limit is reached.',open),field('Discovery interval, minutes','Recheck when no eligible work exists.',interval)),h('label.boss-check',{},auto,'Recover automatically after server restart')),
    h('div.boss-form-actions',{},h('button.btn.primary',{type:'submit'},'Save changes')));
  form.addEventListener('input',dirty);form.addEventListener('change',dirty);
  form.addEventListener('submit',event=>{event.preventDefault();try{
    if(!boss.valid()||!rows.every(r=>r.valid()))throw Error('Choose valid agents and models');
    save(validateBossConfig({...config,mission:mission.value,constraints:constraints.value,roadmap:roadmap.value,initiativePolicy:policy.value,categories:categories.filter(c=>c.input.checked).map(c=>c.input.value),boss:boss.choice(),workerMode:mode.value,models:rows.map(r=>r.choice()),maxWorkers:Number(count.value),delivery:delivery.value,mergeLabel:mergeLabel.value,checks:checks.value.split('\n').map(v=>v.trim()).filter(Boolean),runtimeMinutes:Number(runtime.value),dailyStarts:Number(daily.value),recoveryAttempts:Number(recovery.value),maxOpenPrs:Number(open.value),discoveryMinutes:Number(interval.value),autoRecover:auto.checked}));
  }catch(error){toast((error as Error).message,'error');}});
  return form;
}
