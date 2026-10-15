import type { TeamTask, TeamRun } from '../../shared/master-workers';
import { h } from '../ui/dom';
export function taskCoordination(task:TeamTask,phase:TeamRun['phase']) {
  const box=h('div.team-coordination'),a=task.attempts.at(-1),now=Date.now();
  const age=(at:number)=>`${Math.max(0,Math.floor((now-at)/60000))} min ago`;
  if(task.specification){const s=task.specification;box.append(h('details',{},h('summary',{},'Implementation specification'),h('ol',{},...s.steps.map(v=>h('li',{},v))),h('p',{},'References: '+s.references.join(', ')),h('p',{},'Decisions: '+s.decisions),h('p',{},'Exclusions: '+s.exclusions),h('pre',{},s.verification.join('\n')),h('p.muted',{},s.expectedMinutes?`Advisory estimate: ${s.expectedMinutes} min`:'No duration estimate')));}
  if(task.replacedBy)box.append(h('p',{},'Replaced by: '+task.replacedBy.join(', ')),h('p',{},task.replacementReason));
  if(!a)return box;
  if(a.startedAt!==undefined)box.append(h('p.muted',{},`Assignment started ${age(a.startedAt)} · ${a.acknowledgedAt!==undefined?'acknowledged':'awaiting acknowledgment'}${phase==='paused'?' · monitoring paused':''}`));
  if(a.progress)box.append(h('p',{},`Reported ${age(a.progress.at)}: ${a.progress.step}`),h('details',{},h('summary',{},'Reported progress'),h('p',{},a.progress.completed),h('pre',{},a.progress.checks),h('p',{},'Next: '+a.progress.next)));
  if(a.observation)box.append(h('details',{},h('summary',{},`Observed Git activity · ${age(a.observation.at)}`),h('p.muted',{},a.observation.error??`${a.observation.head?.slice(0,12)} · +${a.observation.additions??0} / −${a.observation.deletions??0}. Activity does not establish correctness.`),h('pre',{},a.observation.paths.join('\n'))));
  for(const v of a.alerts??[])box.append(h('p',{class:!v.clearedAt&&!v.response?'error':'muted',role:!v.clearedAt&&!v.response?'status':undefined},`${v.message} · ${v.clearedAt?'cleared':v.deliveredAt?'delivered to master':'pending delivery'}${v.response?' · Master: '+v.response:''}`));
  if(a.correctionFeedback)box.append(h('p',{},'Review findings: '+a.correctionFeedback));
  if(a.previousResults?.length)box.append(h('details',{},h('summary',{},'Prior result before corrections'),...a.previousResults.map(v=>h('div',{},h('p',{},v.summary),h('pre',{},v.checks),h('p',{},v.commits.join(', '))))));
  return box;
}
export function coordinationMetrics(r:TeamRun) {
  const m=r.metrics;
  return m?h('p.muted',{},`${m.responseBytes.toLocaleString()} agent-response bytes (not tokens) · ${m.masterNotices} master notices · ${m.corrections} correction rounds · ${m.retries} alternate retries · ${m.takeovers} takeovers`):h('p.muted',{},'Coordination metrics unavailable for this activity');
}
