import type { BossItem } from '../../shared/boss-mode/types.js';
import type { BossService } from './service.js';
import { originRepo } from '../forge.js';
export async function feedback(service:BossService,items:BossItem[]) {
  const floor=service.floor,state=service.state();
  if(!items.some(i=>i.pr))return;
  await floor.forge.pulls.refresh();if(floor.forge.pulls.state.error)throw Error(floor.forge.pulls.state.error);
  for(const item of items.filter(i=>i.status==='delivered'&&i.pr)){
    const pr=floor.forge.pulls.items.find(p=>p.url===item.pr);if(!pr)continue;
    if(pr.state==='MERGED') {service.engine.mutate(s=>{const i=s.backlog.find(v=>v.id===item.id);if(i&&!i.merged){i.merged=true;s.events.push({id:crypto.randomUUID(),at:Date.now(),kind:'merge',message:'Merged '+i.title,initiative:i.id});}});continue;}
    if(pr.state!=='OPEN')continue;
    if(pr.checks==='fail'||pr.mergeable==='CONFLICTING'||pr.reviewDecision==='CHANGES_REQUESTED'){
      service.engine.mutate(s=>{const i=s.backlog.find(v=>v.id===item.id)!;i.status='queued';i.followup='Continue the existing PR '+pr.url+'. Inspect CI, conflicts and review comments, fix them on the original branch, add a follow-up task to the existing plan, rerun checks, and finish with the same PR. Do not create another PR.';});continue;
    }
    if(state.config.delivery!=='merge'||pr.checks!=='pass'||pr.reviewDecision!=='APPROVED'||pr.mergeable!=='MERGEABLE'||!pr.labels.some(l=>l.name===state.config.mergeLabel))continue;
    // This project's author restriction takes precedence over an automation setting.
    if(originRepo(floor.dir)==='sagardhande2942/agent-office-sd'&&pr.author!=='webdevcody')continue;
    const error=service.allowed(state.config,state.owner);if(error)throw Error(error);
    if(!pr.headRefOid||!state.config.checks.every(command=>state.checks.some(c=>c.command===command&&c.commit===pr.headRefOid&&c.exitCode===0)))continue;
    await service.merge(pr.number,pr.headRefOid,state.owner);
    service.engine.mutate(s=>{s.events.push({id:crypto.randomUUID(),at:Date.now(),kind:'delivery',message:'Policy-eligible squash merge requested for '+pr.url,initiative:item.id});s.events=s.events.slice(-1000);});
  }
}
