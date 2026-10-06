import { PLAN_CRITERIA, DEFAULT_PLAN_WEIGHTS, type PlanWeights, type DetailedPlan, type PlanRating, type PlanReviewActivity, type PlanReviewRequest } from '../shared/plan-review.js';
import { isAgentProvider, takesModel } from '../shared/providers.js';
import { planModelIdentity } from '../shared/plan-providers.js';
import { isAgentEffort, type AgentChoice } from '../shared/protocol.js';
import { validateWorkerModel, validateWorkerEffort } from './agents.js';

function object(v:unknown,label:string):Record<string,any> { if(!v || typeof v!=='object' || Array.isArray(v)) throw Error(`${label} must be an object`); return v as Record<string,any>; }
function text(v:unknown,label:string,min=1,max=12000):string { if(typeof v!=='string' || v.trim().length<min || v.length>max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) throw Error(`${label} needs ${min}–${max} characters of text`); return v.trim(); }
function list<T>(v:unknown,label:string,map:(item:any)=>T,min=1,max=30):T[] { if(!Array.isArray(v)||v.length<min||v.length>max)throw Error(`${label} needs ${min}–${max} entries`);return v.map(map); }
export function planningChoice(v:unknown):AgentChoice {
  const c=object(v,'model choice');
  if(!isAgentProvider(c.provider)||!takesModel(c.provider))throw Error('Choose a coding agent with selectable models for planning');
  const bad=validateWorkerModel('agent',c.provider,c.model)??validateWorkerEffort('agent',c.provider,c.effort);
  if(bad)throw Error(bad);
  if(takesModel(c.provider)&&!c.model)throw Error('Choose an explicit model for every planning worker and reviewer');
  return {provider:c.provider,model:c.model,...(isAgentEffort(c.effort)?{effort:c.effort}:{})};
}
export function readPlanRequest(value:unknown):PlanReviewRequest & {weights:PlanWeights;minutes:number;constraints:string} {
  const b=object(value,'activity'), candidates=list(b.candidates,'candidates',planningChoice,1,5);
  if(new Set(candidates.map(c=>`${c.provider}:${c.model}`.toLowerCase())).size!==candidates.length)throw Error('Each candidate must use a different explicit model');
  // Claude aliases and the matching OpenCode alias are also the same model choice.
  const identities=candidates.map(c=>planModelIdentity(c.provider,c.model));
  if(new Set(identities).size!==identities.length)throw Error('Candidate model aliases must be distinct');
  const w=object(b.weights??DEFAULT_PLAN_WEIGHTS,'weights'),weights={} as PlanWeights;
  for(const c of PLAN_CRITERIA){if(!Number.isInteger(w[c.id])||w[c.id]<0||w[c.id]>100)throw Error('Weights must be whole numbers between 0 and 100');weights[c.id]=w[c.id];}
  if(Object.values(weights).reduce((a,b)=>a+b,0)!==100)throw Error('Criterion weights must total 100');
  const minutes=b.minutes??20;if(!Number.isInteger(minutes)||minutes<1||minutes>120)throw Error('Planning time must be 1–120 minutes');
  return {brief:text(b.brief,'brief',10,12000),requirements:list(b.requirements,'requirements',v=>text(v,'requirement',5,1500)),constraints:b.constraints===undefined?'':text(b.constraints,'constraints',0,4000),candidates,reviewer:planningChoice(b.reviewer),weights,minutes};
}
export function readDetailedPlan(value:unknown,requirements:string[]):DetailedPlan {
  const b=object(value,'plan');
  const plan:DetailedPlan={
    requirements:list(b.requirements,'requirement mapping',v=>{v=object(v,'requirement mapping');return{id:text(v.id,'requirement ID',1,8),approach:text(v.approach,'requirement approach',60,3000),acceptance:text(v.acceptance,'acceptance',30,2000)};}),
    findings:list(b.findings,'repository findings',v=>{v=object(v,'finding');return{file:text(v.file,'file',1,500),evidence:text(v.evidence,'finding evidence',60,3000)};}),
    design:text(b.design,'design',300,12000),
    steps:list(b.steps,'implementation steps',v=>{v=object(v,'step');return{title:text(v.title,'step title',5,200),files:list(v.files,'step files',f=>text(f,'file',1,500),1,20),details:text(v.details,'step details',100,4000)};},2,30),
    verification:list(b.verification,'verification',v=>{v=object(v,'verification');return{requirement:text(v.requirement,'verification requirement',1,8),check:text(v.check,'check',40,2000),expected:text(v.expected,'expected result',30,2000)};}),
    risks:list(b.risks,'risks',v=>{v=object(v,'risk');return{risk:text(v.risk,'risk',30,2000),mitigation:text(v.mitigation,'mitigation',40,2000)};}),
    assumptions:list(b.assumptions,'assumptions',v=>{v=object(v,'assumption');return{assumption:text(v.assumption,'assumption',30,2000),verify:text(v.verify,'verify assumption',40,2000)};}),
    scope:{included:text(object(b.scope,'scope').included,'included scope',40,2000),excluded:text(object(b.scope,'scope').excluded,'excluded scope',30,2000)},
  };
  const ids=requirements.map((_,i)=>`R${i+1}`),actual=plan.requirements.map(r=>r.id);
  if(actual.length!==ids.length||new Set(actual).size!==ids.length||ids.some(id=>!actual.includes(id)))throw Error('Map every requirement exactly once using R1, R2, …');
  if(plan.verification.some(v=>!ids.includes(v.requirement))||ids.some(id=>!plan.verification.some(v=>v.requirement===id)))throw Error('Give acceptance verification for every requirement ID');
  if(JSON.stringify(plan).length>60000)throw Error('Plan exceeds 60,000 characters');
  return plan;
}
export function readPlanReview(value:unknown,activity:PlanReviewActivity):NonNullable<PlanReviewActivity['review']> {
  const b=object(value,'review');if(b.revision!==activity.revision)throw Error('Plans changed; read the current review revision before rating');
  const ratings=list(b.ratings,'ratings',item=>{
    const v=object(item,'rating'),candidate=activity.candidates.find(c=>c.id===v.candidate);
    if(!candidate)throw Error('Rate only candidates in this activity');
    const scores={} as PlanRating['scores'],scoreReasons={} as PlanRating['scoreReasons'];
    for(const c of PLAN_CRITERIA){const n=object(v.scores,'scores')[c.id];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>10)throw Error('Every criterion needs a score from 0 to 10');scores[c.id]=n;scoreReasons[c.id]=text(object(v.scoreReasons,'scoreReasons')[c.id],`${c.id} score evidence`,30,3000);}
    const gates={} as PlanRating['gates'];
    for(const key of ['coverage','feasibility','detail'] as const){const g=object(object(v.gates,'gates')[key],`${key} gate`);if(typeof g.pass!=='boolean')throw Error('Each gate needs pass: true or false');gates[key]={pass:g.pass,reason:text(g.reason,`${key} gate reason`,30,3000)};}
    if(candidate.clarification && gates.detail.pass) throw Error('An unanswered requested clarification must fail the detail gate');
    const eligible=!!candidate.plan&&!candidate.clarification&&Object.values(gates).every(g=>g.pass);
    if(!candidate.plan&&(Object.values(scores).some(s=>s!==0)||Object.values(gates).some(g=>g.pass)))throw Error('A missing plan must receive zero scores and fail every gate');
    if(!['accept','reject'].includes(v.decision))throw Error('Every candidate needs accept/reject');
    return {candidate:candidate.id,scores,scoreReasons,gates,eligible,score:Math.round(100*Object.values(scores).reduce((sum,_,i)=>sum+scores[PLAN_CRITERIA[i].id]*activity.weights[PLAN_CRITERIA[i].id]/10,0))/100,decision:v.decision,reason:text(v.reason,'acceptance/rejection explanation',100,5000),strengths:list(v.strengths,'strengths',s=>text(s,'strength',20,1500),0,10),weaknesses:list(v.weaknesses,'weaknesses',s=>text(s,'weakness',20,1500),0,10)} as PlanRating;
  },activity.candidates.length,activity.candidates.length);
  if(new Set(ratings.map(r=>r.candidate)).size!==activity.candidates.length)throw Error('Rate each candidate exactly once');
  const winner=ratings.filter(r=>r.eligible).sort((a,b)=>b.score-a.score||b.scores.coverage-a.scores.coverage||b.scores.feasibility-a.scores.feasibility||a.candidate.localeCompare(b.candidate))[0]?.candidate??null;
  if(b.winner!==winner||ratings.some(r=>r.decision!==(r.candidate===winner?'accept':'reject')))throw Error(`Scores select ${winner??'no eligible plan'}; explain that decision consistently. Tie-break: coverage, feasibility, then candidate label.`);
  return {summary:text(b.summary,'overall comparison summary',150,8000),winner,ratings,at:Date.now()};
}
