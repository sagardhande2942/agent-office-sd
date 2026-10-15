import type { TeamRun } from '../../shared/master-workers.js';
import { specification, validateGraph } from './contracts.js';
/** New optional fields are validated without inventing evidence for legacy activities. */
export function validateCoordination(r:TeamRun) {
  const timestamp=(v:unknown)=>{if(v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('Invalid saved coordination timestamp');};
  const short=(v:unknown,max:number)=>{if(v!==undefined&&(typeof v!=='string'||!v.length||v.length>max))throw Error('Invalid saved coordination text');};
  short(r.designSummary,4000);
  if(r.metrics)for(const v of ['responseBytes','masterNotices','corrections','retries','takeovers'].map(k=>r.metrics![k as keyof typeof r.metrics]))if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid saved coordination metrics');
  if(r.tasks.length)validateGraph(r.tasks);
  for(const t of r.tasks){
    if(t.specification)specification(t.specification);
    short(t.recoveryRoot,80);
    if(t.recoveryRoot&&!r.tasks.some(v=>v.id===t.recoveryRoot))throw Error('Missing saved recovery root');
    if(t.replacedBy&&(!Array.isArray(t.replacedBy)||t.status!=='superseded'||!t.replacedBy.length||!t.replacedBy.every(id=>r.tasks.some(v=>v.id===id))))throw Error('Invalid saved replacement lineage');
    for(const a of t.attempts){
      short(a.designSummary,4000);short(a.assignmentId,80);short(a.submittedHead,40);
      for(const v of [a.startedAt,a.reportingSince,a.acknowledgedAt])timestamp(v);
      if(a.specification)specification(a.specification);
      if(a.corrections!==undefined&&a.corrections!==1)throw Error('Invalid saved correction count');
      if(a.previousResults&&(!Array.isArray(a.previousResults)||a.previousResults.length>1||a.previousResults.some(v=>typeof v.summary!=='string'||typeof v.checks!=='string'||!Array.isArray(v.commits)||v.commits.length>100)))throw Error('Invalid saved previous results');
      if(a.progress){const p=a.progress;timestamp(p.at);if(!Number.isSafeInteger(p.sequence)||p.sequence<1)throw Error('Invalid saved progress sequence');short(p.step,1000);short(p.completed,2000);short(p.checks,2000);short(p.next,1000);short(p.blocker,2000);}
      if(a.observation){timestamp(a.observation.at);if(!Array.isArray(a.observation.paths)||a.observation.paths.length>100||a.observation.paths.some(p=>typeof p!=='string'||!p.length||p.length>10000))throw Error('Invalid saved observed paths');short(a.observation.error,2000);}
      if(a.alerts){
        if(!Array.isArray(a.alerts)||a.alerts.length>20)throw Error('Invalid saved alerts');
        for(const v of a.alerts){short(v.id,80);short(v.message,4000);short(v.response,4000);if(!['unknown','estimate','blocker'].includes(v.kind))throw Error('Invalid saved alert kind');for(const at of [v.at,v.deliveredAt,v.clearedAt,v.respondedAt])timestamp(at);}
      }
    }
  }
}
