import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WORKFLOW, workflowProblem } from '../src/shared/meeting-workflows.js';
import { MEETING_PATTERN_IDS, isMeetingPattern } from '../src/shared/meetings.js';
import type { Meeting } from '../src/shared/protocol.js';
import { planMeeting } from '../src/server/meeting-patterns/index.js';
import { validateCustomResult } from '../src/server/meeting-patterns/custom.js';
const meeting=()=>({ id:'session-42', pattern:'custom', workflow:structuredClone(DEFAULT_WORKFLOW), patternVersion:1, output:'docs/result.json',notes:'.meeting/session-42',rounds:2,seats:DEFAULT_WORKFLOW.roles.map(role=>({role,deskId:'chair'})) }) as Meeting;

test('only generic patterns are built in; custom stages and rules are caller data',()=>{
  assert.deepEqual(MEETING_PATTERN_IDS,['custom','debate','lead','mapreduce','redblue','review']);
  assert.equal(isMeetingPattern('constructor'),false); assert.equal(workflowProblem(DEFAULT_WORKFLOW),undefined);
  const m=meeting();
  for(let round=1;round<=2;round++) {
    const parts=planMeeting(m,round,1,'/fixture',()=>{throw Error('wrong planner');}); assert.ok(parts?.length);
    assert.ok(parts.every(p=>!p.ask.includes('{{role}}'))); assert.equal(planMeeting(m,round,2,'/fixture',()=>''),null);
  }
  assert.equal(planMeeting(m,3,1,'/fixture',()=>''),null);
  assert.equal(validateCustomResult(m,{summary:'Reviewed'}),undefined);
  assert.match(validateCustomResult(m,{summary:' '})!,/summary/);
});
test('definitions reject unbounded stages, invalid seats, unknown keys and unsafe field paths',()=>{
  for(const mutate of [
    (w:any)=>w.stages=[], (w:any)=>w.stages[0].turns[0].seats=[99],
    (w:any)=>w.stages[0].turns[0].seats=[0,0], (w:any)=>w.result.rules[0].path='__proto__.polluted',
    (w:any)=>w.execute='arbitrary', (w:any)=>w.stages[0].turns[0].prompt='{{unknown}}',
    (w:any)=>w.stages[0].turns[0].output=true,
  ]) { const w=structuredClone(DEFAULT_WORKFLOW);mutate(w);assert.ok(workflowProblem(w)); }
});
test('generic conditional result rules enforce caller identity, enums and required references',()=>{
  const m=meeting();m.workflow!.result.rules.push(
    {path:'session',type:'string',equals:'{{meeting_id}}'},
    {path:'outcome',type:'string',enum:['ready','blocked']},
    {path:'references',type:'strings',minItems:1,when:{outcome:'ready'}},
  );
  const v={summary:'Reviewed',session:m.id,outcome:'blocked'};assert.equal(validateCustomResult(m,v),undefined);
  assert.match(validateCustomResult(m,{...v,session:'other'})!,/session/);
  assert.match(validateCustomResult(m,{...v,outcome:'ready',references:[]})!,/references/);
  assert.match(validateCustomResult(m,{...v,outcome:'ready',references:['a','a']})!,/references/);
  assert.equal(validateCustomResult(m,{...v,outcome:'ready',references:['a']}),undefined);
  assert.match(validateCustomResult({...m,patternVersion:2},v)!,/version/);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('conditional stages skip needless work and fail closed on absent, mistyped or escaped notes',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'workflow-condition-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const m=meeting(),w=m.workflow!;
  w.stages.splice(1,0,{label:'Correction',when:{round:1,seat:1,field:'needs_changes',equals:true},turns:[{seats:[1],prompt:'Correct the reported issue'}]});
  assert.equal(workflowProblem(w),undefined);
  mkdirSync(path.join(root,m.notes),{recursive:true}); const file=path.join(root,m.notes,'r1-seat2.md');
  assert.throws(()=>planMeeting(m,2,1,root,()=>''));
  writeFileSync(file,JSON.stringify({needs_changes:false}));assert.deepEqual(planMeeting(m,2,1,root,()=>''),[]);
  writeFileSync(file,JSON.stringify({needs_changes:true}));assert.equal(planMeeting(m,2,1,root,()=>'')!.length,1);
  for(const value of ['not JSON','{}','{"needs_changes":"false"}']) {writeFileSync(file,value);assert.throws(()=>planMeeting(m,2,1,root,()=>''));}
  rmSync(file);symlinkSync('/etc/hosts',file);assert.throws(()=>planMeeting(m,2,1,root,()=>''));
  for(const mutate of [(v:any)=>v.stages[1].when.round=2,(v:any)=>v.stages[1].when.field='__proto__.x',(v:any)=>v.stages[2].when={round:1,seat:1,field:'x',equals:true},(v:any)=>v.stages[0].turns[0].seats=[0]]) {
    const invalid=structuredClone(w);mutate(invalid);assert.ok(workflowProblem(invalid));
  }
});
