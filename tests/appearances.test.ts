import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Appearances, type AppearanceWorker } from '../src/server/appearances.js';
import { defaultAppearanceConfig, FICTIONAL_CHARACTERS, validAppearanceConfig } from '../src/shared/appearances.js';
import { appearanceHandlers } from '../src/server/ws/handlers/appearances.js';
const roster=FICTIONAL_CHARACTERS.map(([id])=>id);
function fixture(t: any, count=0) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'looks-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const workers: AppearanceWorker[]=Array.from({length:count},(_,i)=>({id:`w${i}`,createdAt:i,floor:i%2?'f1':'f2'}));
  const published: any[]=[];const service=new Appearances(dir,()=>workers,s=>published.push(s));service.activate();return {dir,workers,service,published};
}
test('twenty identities, validation rejects empty and duplicate selections',()=>{
 assert.equal(roster.length,20);assert.equal(new Set(roster).size,20);
 for(const config of [{categories:[],characters:roster},{categories:['fictional'],characters:[]},{categories:['alien'],characters:roster},{categories:['original','original'],characters:roster},{categories:['fictional'],characters:['naruto','naruto']},null])assert.equal(validAppearanceConfig(config),false);
 assert.equal(validAppearanceConfig(defaultAppearanceConfig()),true);
});
test('unique allocation across floors with overflow, retaining assignments on updates',t=>{
 const {service,workers}=fixture(t,22);service.set({categories:['fictional'],characters:roster});
 const before=service.state().assignments;assert.equal(new Set(Object.values(before).filter(id=>id!=='original')).size,20);assert.equal(Object.values(before).filter(id=>id==='original').length,2);
 workers.reverse();service.reconcile();assert.deepEqual(service.state().assignments,before);
 workers.splice(workers.findIndex(w=>w.id==='w0'),1);service.reconcile();assert.equal(service.state().assignments.w20,'naruto');assert.equal(service.state().assignments.w21,'original');
});
test('mixed categories alternate new slots starting Original',t=>{
 const {service,workers}=fixture(t,4);service.set({categories:['original','fictional'],characters:['naruto','pikachu']});
 assert.deepEqual(Object.values(service.state().assignments),['original','naruto','original','pikachu']);
 workers.push({id:'w4',createdAt:4},{id:'w5',createdAt:5});service.reconcile();assert.equal(service.state().assignments.w5,'original');
 workers.splice(1,1);service.reconcile();assert.equal(service.state().assignments.w5,'naruto');assert.equal(service.state().assignments.w4,'original');
});
test('pool edits preserve eligible workers and replace disabled characters immediately',t=>{
 const {service}=fixture(t,3);service.set({categories:['fictional'],characters:['naruto','pikachu','goku']});
 service.set({categories:['fictional'],characters:['pikachu','goku','mario']});assert.deepEqual(service.state().assignments,{w0:'mario',w1:'pikachu',w2:'goku'});
 service.set({categories:['original'],characters:roster});assert.deepEqual(Object.values(service.state().assignments),['original','original','original']);
});
test('restart retains configuration, identities and alternating next slot',t=>{
 const {service,dir,workers}=fixture(t,3);service.set({categories:['original','fictional'],characters:roster});
 const before=service.state();const restored=new Appearances(dir,()=>workers,()=>{});assert.deepEqual(restored.state(),before);restored.activate();
 workers.push({id:'w3',createdAt:3});restored.reconcile();assert.equal(restored.state().assignments.w3,'pikachu');
});
test('offline and partially hydrated remote rosters reserve identities across restart',t=>{
 const {service,dir,workers}=fixture(t,2);service.set({categories:['fictional'],characters:roster});
 workers.splice(0,1);let reserve=true;const restored=new Appearances(dir,()=>workers,()=>{},w=>reserve&&w.id==='w0');restored.activate();assert.equal(restored.state().assignments.w0,'naruto');
 workers.push({id:'new',createdAt:10});restored.reconcile();assert.equal(restored.state().assignments.new,'goku');
 reserve=false;restored.reconcile();assert.equal(restored.state().assignments.w0,undefined);
});
test('failed writes roll back a settings change and do not broadcast it',t=>{
 const {dir,service,published}=fixture(t,1);const before=service.state();fs.mkdirSync(path.join(dir,'worker-appearances.json.tmp'));
 const count=published.length;assert.match(service.set({categories:['fictional'],characters:roster})! ,/save/);assert.deepEqual(service.state(),before);assert.equal(published.length,count);
});
test('only admins may mutate appearance settings',()=>{
 let called=false;let warning='';const ctx={meOf:()=>({admin:false}),warn:(_c:any,s:string)=>{warning=s;},appearances:{set:()=>{called=true;}}};
 appearanceHandlers['appearance.set'](ctx as any,{} as any,{t:'appearance.set',config:defaultAppearanceConfig()});assert.equal(called,false);assert.match(warning,/admins/);
});
