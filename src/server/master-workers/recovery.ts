import type { TeamRun, TeamTaskDefinition } from '../../shared/master-workers.js';
import { definition, validateGraph, dispatchContract } from './contracts.js';
import { text } from './storage.js';
import { recordedText, recordEvent } from '../task-replay/index.js';
export function replaceTasks(r:TeamRun,id:string,raw:TeamTaskDefinition[],reason:string) {
  const old=r.tasks.find(t=>t.id===id);
  if(!old||old.status!=='pending'||!old.attempts.length)throw Error('Cancel or reject an attempted task before replacing it');
  if(!Array.isArray(raw)||!raw.length||raw.length>10)throw Error('Provide 1–10 replacement tasks');
  const evidence=text(reason,'replacement diagnosis and retained commits',4000);
  const root=old.recoveryRoot??old.id;
  const replacements=raw.map(v=>({...definition(v),recoveryRoot:root}));
  for(const t of replacements){
    if(r.tasks.some(v=>v.id===t.id))throw Error('Replacement task IDs must be new');
    dispatchContract([],t);
    t.dependencies=[...new Set([...old.dependencies,...t.dependencies])];
  }
  const ids=replacements.map(t=>t.id);
  const tasks=r.tasks.map(t=>{
    if(t.id===old.id)return {...t,status:'superseded' as const,replacedBy:ids,replacementReason:evidence};
    if(!t.dependencies.includes(old.id))return t;
    if(t.status!=='pending'||t.attempts.length)throw Error('Replacement cannot invalidate a started dependent');
    return {...t,dependencies:[...new Set(t.dependencies.flatMap(d=>d===old.id?ids:[d]))]};
  }).concat(replacements);
  validateGraph(tasks);
  // Superseded tasks may not become executable prerequisites again.
  if(tasks.some(t=>t.status!=='superseded'&&t.dependencies.some(d=>tasks.find(v=>v.id===d)?.status==='superseded')))throw Error('Depend on replacement tasks instead of superseded tasks');
  r.tasks=tasks;
  recordEvent(r,{type:'replacement',taskId:id,participantId:r.masterId,summary:`Task ${id} replaced by ${ids.join(', ')}`,details:{reviewReason:evidence,instructions:JSON.stringify(replacements,(_key,value)=>typeof value==='string'?recordedText(value).text:value)}});
}
export function recoveryBudget(r:TeamRun,id:string) {
  const t=r.tasks.find(t=>t.id===id)!,root=t.recoveryRoot??t.id;
  const used=r.tasks.filter(v=>(v.recoveryRoot??v.id)===root).reduce((n,v)=>n+v.attempts.length,0);
  if(used>=3)throw Error('Recovery lineage exhausted: master must take over remaining work');
}
