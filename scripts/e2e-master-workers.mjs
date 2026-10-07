// npm run build && node --import tsx scripts/e2e-master-workers.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
const output=path.resolve(process.env.TEAM_ARTIFACTS??'/tmp/agent-office-master-workers-evidence');mkdirSync(output,{recursive:true});
const dir=mkdtempSync(path.join(os.tmpdir(),'office-team-browser-')),binary=path.join(dir,'claude');
writeFileSync(binary,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`,{mode:0o755});
execFileSync('git',['init','-q','-b','main'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-qm','fixture'],{cwd:dir});
const cfg=loadConfig([dir,'--password','team-browser','--no-open','--agent',binary]);cfg.port=0;
const preset={id:'test-preset',name:'Economical coding team',master:{provider:'claude',model:'opus'},models:[{provider:'claude',model:'haiku'},{provider:'claude',model:'sonnet'}],maxWorkers:5};
writeFileSync(path.join(cfg.dataDir,'master-workers-presets.json'),JSON.stringify([preset]));
const office=await startServer(cfg,{publicDir:path.resolve('dist/public')}),base=`http://127.0.0.1:${office.server.address().port}`;
const cache=path.join(os.homedir(),'.cache/ms-playwright'),executable=process.env.CHROMIUM_PATH??path.join(cache,readdirSync(cache).find(x=>x.startsWith('chromium-')),'chrome-linux64/chrome');
const errors=[],checks=[];let browser,page,state;
const check=(name)=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
try {
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 // Focus/menu checks exercise the shared game without expensive software-GPU scene draws.
 await context.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(ts=>{const r=window.__office?.renderer;if(r)r.render=()=>{};cb(ts);});});
 await context.addInitScript(()=>localStorage.setItem('agent-office.profile',JSON.stringify({name:'Team tester',color:'#ef476f',look:{skin:0,hair:0,style:0}})));
 const login=await context.request.post(base+'/api/login',{data:{password:'team-browser'}});assert.ok(login.ok());
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',ws=>ws.on('framereceived',frame=>{try{const m=JSON.parse(String(frame.payload));if(m.t==='welcome'||m.t==='floor.enter')state=m.masterWorkers;if(m.t==='master-workers')state=m.state;}catch{}}));
 await page.goto(base+'/lite');await page.getByRole('button',{name:'Master / Workers',exact:true}).click();
 await page.getByLabel('Team preset').selectOption('test-preset');
 await page.getByLabel('Task brief').fill('Build a documented API and matching frontend under one PR.');
 await page.getByLabel('Requirements',{exact:true}).fill('Implement a typed users API\nBuild the users screen\nRun integration checks and create one PR');
 await page.getByLabel('Constraints',{exact:true}).fill('Use existing modules and registries. No new runtime dependencies.');
 await page.getByLabel('Preset name').fill('Frontend and API team');await page.getByRole('button',{name:'Save preset',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Team preset"]').selectedOptions[0].textContent==='Frontend and API team');
 assert.equal(await page.getByLabel('Task brief').inputValue(),'Build a documented API and matching frontend under one PR.');
 check('Preset editing persists on the server without losing the task draft');
 await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Team preset"]').options.length===3);
 await page.getByRole('button',{name:'Delete preset',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Team preset"]').options.length===2);
 await page.getByLabel('Team preset').selectOption('test-preset');
 await page.locator('.team-mode').evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:path.join(output,'setup-desktop.png')});check('Preset duplicate/delete and loaded explicit model settings');
 await page.setViewportSize({width:390,height:844});await page.locator('.team-mode').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(output,'setup-mobile.png')});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('Mobile layout stays within the viewport');
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Start Master / Workers',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.team-overview')?.textContent.includes('running'));
 const floor=office.floors()[0],master=state.current.masterId;
 const call=async(id,action)=>{
  const token=JSON.parse(readFileSync(path.join(dir,'.agent-office/workers.json'),'utf8')).find(w=>w.id===id).hookToken;
  const root=`http://127.0.0.1:${office.hookPort}/office/team?worker=${id}`,headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  const r=await fetch(root,{headers});const current=(await r.json()).current;
  const res=await fetch(root,{method:'POST',headers,body:JSON.stringify({id:current.id,revision:current.revision,...action})});const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;
 };
 await call(master,{action:'plan',plan:'The master owns architecture, integration and the final PR. Independent API and frontend tasks go to eligible models; final checks wait for both accepted contributions.',tasks:[{id:'api',title:'Typed users API',instructions:'Implement the API in its own module and verify its contract.',acceptance:'Users API returns a typed user list; scoped tests pass.',files:['src/api/users.ts'],dependencies:[]},{id:'frontend',title:'Users screen',instructions:'Build the UI against the agreed API contract.',acceptance:'Screen handles loading, empty and populated responses.',files:['src/client/users.ts'],dependencies:[]},{id:'verify',title:'Final integration and one PR',instructions:'Review worker diffs, integrate, run required checks and create the only PR.',acceptance:'All requirements verified; one ready-for-review PR.',files:[],dependencies:['api','frontend']}]});
 const dispatched=await call(master,{action:'dispatch',task:'api',choice:{provider:'claude',model:'haiku'},reason:'A bounded API task is suitable for a cheaper eligible model.'});
 const worker=dispatched.current.tasks[0].attempts[0].workerId;
 await call(worker,{action:'result',task:'api',summary:'Contract research is ready for master review.',commits:[],checks:'Inspected existing route interfaces; implementation evidence is still required.'});
 await page.getByText('Typed users API · review',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'activity-desktop.png')});
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
 await page.getByRole('button',{name:'Resume',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();check('Real team setup, task graph, worker result and pause/resume render correctly');
 await page.keyboard.press('Escape');await page.locator('.backdrop').waitFor({state:'hidden'});
 await page.goto(base+'/?3d=1');await page.waitForFunction(()=>window.__office?.net.up&&window.__office.player.enabled);
 await page.waitForSelector('#loading',{state:'hidden'});
 const menu=async()=>{await page.keyboard.press('Tab');await page.getByRole('menuitem',{name:/Master \/ Workers/}).click();await page.getByRole('dialog',{name:'Master / Workers',exact:true}).waitFor();};
 await menu();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.backdrop')&&document.activeElement?.id==='scene'&&window.__office.player.enabled&&window.__office.player.hasMouse);
 await menu();await page.getByRole('dialog',{name:'Master / Workers',exact:true}).getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.backdrop')&&document.activeElement?.id==='scene'&&window.__office.player.enabled&&window.__office.player.hasMouse);
 check('Shared game menu exposes the mode; Esc and close restore player controls without another click');
 assert.deepEqual(errors,[]);check('No browser runtime errors');writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,screenshots:['setup-desktop.png','setup-mobile.png','activity-desktop.png']},null,2));
} catch(e){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(errors);console.error('URL:',page?.url());console.error('Menu:',await page?.getByRole('menuitem').allTextContents().catch(()=>[]));throw e;}
finally{await browser?.close();office.shutdown();await new Promise(r=>setTimeout(r,250));rmSync(dir,{recursive:true,force:true});}
console.log(`Evidence: ${output}`);

process.exit(0);
