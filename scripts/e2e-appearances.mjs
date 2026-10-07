// Production office, isolated shells and real Settings controls. No agent work is launched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { DESKS } from '../src/shared/layout.ts';
const output=path.resolve(process.env.APPEARANCE_ARTIFACTS??'docs/appearance-evidence');fs.mkdirSync(output,{recursive:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-appearances-'));
const floors=['f1','f2'].map((id,i)=>{const checkout=path.join(dir,id);fs.mkdirSync(checkout);execFileSync('git',['init','-b','main'],{cwd:checkout,stdio:'ignore'});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-m','fixture'],{cwd:checkout,stdio:'ignore'});return {id,name:`Appearance floor ${i+1}`,dir:checkout,palette:i,addedBy:'test',addedAt:1};});
const data=path.join(dir,'.agent-office');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'floors.json'),JSON.stringify(floors));
const cfg=loadConfig(['--home',dir,'--port','4600','--password','appearance-test','--no-open']);cfg.port=0;
const office=await startServer(cfg,{publicDir:path.resolve('dist/public')});
const base=`http://127.0.0.1:${office.server.address().port}`;
const checks=[],errors=[];let browser;
const check=(name)=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
try {
 const cache=path.join(os.homedir(),'.cache/ms-playwright');
 const executable=process.env.CHROMIUM_PATH??path.join(cache,fs.readdirSync(cache).find(x=>x.startsWith('chromium-')),'chrome-linux64/chrome');
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{
  localStorage.setItem('agent-office.profile',JSON.stringify({name:'Appearance tester',color:'#ef476f',look:{skin:0,hair:0,style:0}}));
  // Keep real simulation/input ticks running; render the large office on demand on software GPUs.
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=fn=>raf(t=>{
   const g=window.__game2d;
   if(g&&!window.__renderOnce){const entries=g.ctx.ticks.phases.get('render')?.items??[];window.__renderOnce=()=>entries.forEach(e=>e.fn({delta:0,dt:0,t:t/1000,now:t}));g.ctx.ticks.phases.delete('render');}
   fn(t);
  });
 });
 const login=await context.request.post(base+'/api/login',{data:{password:'appearance-test'}});assert.ok(login.ok());
 const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/2d?floor=f1');
 const wait=(fn,arg)=>page.waitForFunction(fn,arg,{polling:100});
 await wait(()=>window.__game2d?.ctx.net.up&&window.__game2d.store.floor==='f1'&&!window.__game2d.core.trip&&window.__game2d.ctx.player.enabled);
 await wait(()=>!document.getElementById('loading')||document.getElementById('loading').classList.contains('gone'));
 console.log('Loaded playable office');
 const hosted=office.floors();const shells=[];
 for(const floor of hosted)for(let i=0;i<11;i++){const worker=floor.workers.spawn(DESKS[i].id,'appearance test',undefined,false,'shell');assert.equal(typeof worker,'object');shells.push(worker);}
 await wait(()=>window.__game2d.store.workers.size===11);
 const identities=shells.map(w=>({id:w.id,sessionId:w.sessionId}));
 async function settings(){await page.keyboard.press('Tab');await page.getByRole('menuitem',{name:/Settings/}).click({force:true});await page.getByRole('tab',{name:/Workers/}).click({force:true});await page.getByText('Worker appearances',{exact:true}).waitFor();}
 async function close(button=false){if(button)await page.locator('.modal.settings button.close').click({force:true});else await page.keyboard.press('Escape');await wait(()=>!document.querySelector('.backdrop')&&window.__game2d.ctx.player.enabled);}
 await settings();assert.equal(await page.locator('.appearance-card').count(),20);
 await page.getByLabel('Fictional workers',{exact:true}).check({force:true});await page.getByLabel('Original workers',{exact:true}).uncheck({force:true});await page.getByRole('button',{name:'Apply appearances',exact:true}).click({force:true});
 await wait(()=>Object.values(window.__game2d.store.appearances.assignments).filter(id=>id!=='original').length===20);
 const assignments=await page.evaluate(()=>window.__game2d.store.appearances.assignments);
 assert.equal(new Set(Object.values(assignments).filter(id=>id!=='original')).size,20);assert.equal(Object.values(assignments).filter(id=>id==='original').length,2);
 const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(base+'/lite?floor=f2');
 await viewer.waitForFunction(()=>window.__lite?.store.floor==='f2'&&Object.keys(window.__lite.store.appearances.assignments).length===22,undefined,{polling:100});
 assert.deepEqual(await viewer.evaluate(()=>window.__lite.store.appearances.assignments),assignments);await viewer.close();
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,'worker-appearances.json'),'utf8')).assignments,assignments);
 check('unique building allocation, overflow, synchronization and persistence');
 await page.locator('.appearance-roster').screenshot({path:path.join(output,'roster.png')});
 await page.locator('.modal.settings').screenshot({path:path.join(output,'settings.png')});
 // An assignment update must not reset an unsaved Settings selection.
 await page.getByLabel('Enable Naruto',{exact:true}).uncheck({force:true});
 await page.evaluate(()=>{const g=window.__game2d;g.store.apply({t:'appearance',state:structuredClone(g.store.appearances)});});
 assert.equal(await page.getByLabel('Enable Naruto',{exact:true}).isChecked(),false);
 await page.getByLabel('Enable Naruto',{exact:true}).check({force:true});await close(true);await settings();await close();check('twenty portraits, draft preservation and Settings close controls');
 await wait(()=>[...window.__game2d.parts.views.workerViews].every(([id,v])=>v.model.appearanceId===window.__game2d.store.appearances.assignments[id]));
 const first=await page.evaluate(()=>{const g=window.__game2d;return [...g.parts.views.workerViews].find(([,v])=>v.model.appearanceId!=='original')[0];});
 const poses=await page.evaluate(id=>{
  const g=window.__game2d,v=g.parts.views.workerViews.get(id),m=v.model;
  window.__appearanceRoot=m.root;
  const counts=[];
  for(let i=0;i<6;i++){m.setAppearance('pikachu');m.setAppearance('naruto');let n=0;m.root.traverse(()=>n++);counts.push(n);}
  m.setStatus('working',false);m.setAction('type');for(let i=0;i<30;i++)m.update(.1,i*.1);
  const arms=[m.armL.rotation.x,m.armR.rotation.x];m.walking=true;m.update(.1,4);const step=m.feet.map(f=>f.position.z);m.walking=false;m.setStatus('needs_input',true);m.update(.1,5);m.celebrate();m.update(.1,6);
  return {counts,arms,step,finite:m.body.position.toArray().every(Number.isFinite)};
 },first);
 assert.equal(new Set(poses.counts).size,1);assert.ok(poses.finite);assert.ok(poses.arms.every(Number.isFinite));assert.ok(poses.step.every(Number.isFinite));
 await page.evaluate(()=>{window.__game2d.camera.span=25;window.__renderOnce();});await page.screenshot({path:path.join(output,'office-2d.png')});
 check('live visual swaps and shared typing, walking, waiting and celebration poses');
 const removed=shells.find(w=>assignments[w.id]!=='original');const free=assignments[removed.id];
 const overflow=shells.filter(w=>assignments[w.id]==='original').sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))[0];
 await hosted.find(f=>f.workers.get(removed.id)).workers.kill(removed.id,false);
 await wait(({id,free})=>window.__game2d.store.appearances.assignments[id]===free,{id:overflow.id,free});check('vacancy promotes oldest fictional fallback without duplicates');
 await settings();await page.getByLabel('Original workers',{exact:true}).check({force:true});await page.getByLabel('Fictional workers',{exact:true}).uncheck({force:true});await page.getByRole('button',{name:'Apply appearances',exact:true}).click({force:true});
 await wait(()=>Object.values(window.__game2d.store.appearances.assignments).every(id=>id==='original'));await close();
 const current=hosted.flatMap(f=>f.workers.list()).map(w=>({id:w.id,sessionId:w.sessionId}));assert.deepEqual(current,identities.filter(w=>w.id!==removed.id));
 check('immediate Original reset preserves agent sessions');
 await page.evaluate(()=>window.__game2d.ctx.net.send({t:'appearance.set',config:{categories:['fictional'],characters:['naruto']}}));
 await wait(()=>Object.values(window.__game2d.store.appearances.assignments).includes('naruto'));
 await page.goto(base+'/?floor=f1');
 await wait(()=>window.__office?.net.up&&window.__office.store.floor==='f1'&&window.__office.player.enabled);
 console.log('Loaded first-person office');
 await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
 // Stand at the rendered fictional worker and aim the actual office camera at its face.
 await page.evaluate(()=>{const g=window.__office;const v=[...g.workerViews.values()].find(v=>v.model.appearanceId==='naruto');if(!v)throw Error('No fictional body');v.model.blink(0,1);const at=v.model.root.getWorldPosition(g.camera.position.clone());g.camera.position.copy(at).add({x:1.6,y:1.05,z:2.0});g.camera.lookAt(at.x,at.y+.7,at.z);g.renderer.render(g.scene,g.camera);});
 await page.screenshot({path:path.join(output,'office-3d.png')});
 await page.keyboard.press('Tab');await page.getByRole('menuitem',{name:/Settings/}).click({force:true});await page.keyboard.press('Escape');await wait(()=>!document.querySelector('.backdrop'));await wait(()=>document.pointerLockElement?.id==='scene');
 await page.keyboard.press('Tab');await page.getByRole('menuitem',{name:/Settings/}).click({force:true});await page.locator('.modal.settings button.close').click({force:true});await wait(()=>!document.querySelector('.backdrop'));await wait(()=>document.pointerLockElement?.id==='scene');
 check('real 3D appearance rendering and Esc/close mouse-look restoration');
 assert.deepEqual(errors,[]);
} finally {
 fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));await browser?.close();office.shutdown();fs.rmSync(dir,{recursive:true,force:true});
}
