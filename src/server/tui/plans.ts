import type { FloorView } from '../../shared/protocol.js';
import { plain } from './text.js';
export function planLines(view:FloorView|undefined,width:number):string[] {
    const m=view?.planReview?.current;
    const wrap=(line:string)=>{const safe=plain(line);return Array.from({length:Math.max(1,Math.ceil(safe.length/width))},(_,i)=>safe.slice(i*width,(i+1)*width));};
  return (m?[`PLAN COMPARISON: ${m.phase}`,m.brief,...m.requirements.map((r,i)=>`R${i+1}: ${r}`),m.error??'',`Accepted: ${m.review?.winner??'not selected'}`,m.review?.summary??'',...m.candidates.flatMap(c=>{const r=m.review?.ratings.find(r=>r.candidate===c.id);return [`Candidate ${c.id}: ${c.choice.provider}/${c.choice.model}`,`Worker: ${c.workerId} (${c.cleanup?.done?'sent home':c.plan?'plan submitted':'planning'})`,r?`${r.decision} ${r.score}/100: ${r.reason}`:'',...(r?Object.entries(r.scoreReasons).map(([k,v])=>`${k}: ${r.scores[k as keyof typeof r.scores]}/10 - ${v}`):[]),...(c.plan?['PLAN: '+JSON.stringify(c.plan)]:[])]}),`Reviewer: ${m.reviewer.workerId}`,'','Commands: plan-stop | plan-retry | attach <worker>']:['No plan comparison yet.','plan-start <JSON-file> starts candidates and a reviewer.']).flatMap(wrap);
}
