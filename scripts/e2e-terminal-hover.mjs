// npm run build && node --import tsx scripts/e2e-terminal-hover.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
const output=path.resolve(process.env.TERMINAL_HOVER_ARTIFACTS??'/tmp/agent-office-terminal-hover-evidence');mkdirSync(output,{recursive:true});
const dir=mkdtempSync(path.join(os.tmpdir(),'office-terminal-hover-')),binary=path.join(dir,'claude');
writeFileSync(binary,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`,{mode:0o755});
execFileSync('git',['init','-q','-b','main'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-qm','fixture'],{cwd:dir});
const cfg=loadConfig([dir,'--password','terminal-hover','--no-open','--agent',binary]);cfg.port=0;
const office=await startServer(cfg,{publicDir:path.resolve('dist/public')}),base=`http://127.0.0.1:${office.server.address().port}`;
const cache=path.join(os.homedir(),'.cache/ms-playwright'),executable=process.env.CHROMIUM_PATH??path.join(cache,readdirSync(cache).find(x=>x.startsWith('chromium-')),'chrome-linux64/chrome');
const errors=[],checks=[];let browser,page;
const check=(name)=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
try {
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('agent-office.profile',JSON.stringify({name:'Hover tester',color:'#ef476f',look:{skin:0,hair:0,style:0}})));
 const login=await context.request.post(base+'/api/login',{data:{password:'terminal-hover'}});assert.ok(login.ok());
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__three*',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('node_modules/three/build/'+(route.request().url().endsWith('core.js')?'three.core.js':'three.module.js'),'utf8').replaceAll('./three.core.js','/__three-core.js')}));
 await page.goto(base+'/');
 await page.waitForFunction(()=>window.__office?.player);
 await page.waitForSelector('#loading', {state:'hidden'});
 const floor=office.floors()[0];
 const shell=floor.workers.spawn('desk-1','e2e',undefined,false,'shell');
 assert.equal(typeof shell,'object');
 await page.waitForFunction(id=>window.__office.workerViews.has(id),shell.id);
 await page.waitForTimeout(1500);
 async function aim(part, distance = 4.15) {
  await page.evaluate(({id,part,distance}) => {
   const g=window.__office, d=g.office.desks.get('desk-1'), v=g.workerViews.get(id);
   const point=part === 'screen'
    ? v.laptop.root.children[0].children[0].localToWorld(g.player.pos.clone().set(0,0,0))
    : v.laptop.root.localToWorld(g.player.pos.clone().set(0,0.04,0));
   const pos=d.group.localToWorld(g.player.pos.clone().set(0,0,distance));
   g.player.pos.copy(pos);g.player.view='first';
   g.player.camYaw=Math.atan2(pos.x-point.x,pos.z-point.z);
   g.player.lookPitch=Math.atan2(point.y-(pos.y+1.4),Math.hypot(point.x-pos.x,point.z-pos.z));
  },{id:shell.id,part,distance});
  // Let camera matrices and the aim tick both observe the new view before asserting.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 }
 await aim('screen');
 await page.waitForFunction(()=>document.querySelector('#crosshair').classList.contains('on') && document.querySelector('#hint').textContent.includes('Open terminal'));
 await page.screenshot({path:path.join(output,'screen-hover.png')});
 check('Screen highlights at the reproduced boundary: screen hit over 4.5m away, desk interaction spot 2.9m away');
 await aim('keyboard');
 await page.waitForFunction(()=>document.querySelector('#crosshair').classList.contains('on') && document.querySelector('#hint').textContent.includes('Open terminal'));
 check('Keyboard and screen both highlight from the same standing position');
 await aim('screen');
 await page.waitForTimeout(500);
 await page.evaluate(async()=>{
  const T=await import('/__three.js'),g=window.__office;
  const point=g.workerViews.values().next().value.laptop.root.children[0].children[0].getWorldPosition(new T.Vector3());
  const wall=new T.Mesh(new T.BoxGeometry(1.5,1.5,0.1),new T.MeshBasicMaterial({color:'#555555'}));
  wall.position.copy(g.camera.position).lerp(point,0.5);g.office.group.add(wall);window.__hoverWall=wall;
 });
 await page.waitForFunction(()=>!document.querySelector('#crosshair').classList.contains('on'));
 check('Solid obstruction still prevents highlighting a nearby desk');
 await page.evaluate(()=>{const wall=window.__hoverWall;wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();delete window.__hoverWall;});
 await aim('screen',6.5);
 await page.waitForTimeout(500);
 assert.equal(await page.locator('#crosshair').evaluate(el=>el.classList.contains('on')),false);
 check('Distant desk stays out of reach');
 await aim('screen');
 await page.waitForFunction(()=>document.querySelector('#crosshair').classList.contains('on'));
 await page.keyboard.press('KeyE');
 await page.locator('.modal.term').waitFor();
 await page.screenshot({path:path.join(output,'terminal-open.png')});
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('.backdrop') && window.__office.player.enabled && window.__office.player.hasMouse);
 check('E opens the highlighted terminal and Esc restores mouse-look');
 await page.waitForFunction(()=>document.querySelector('#crosshair').classList.contains('on'));
 await page.locator('#scene').click({position:{x:720,y:500}});
 await page.locator('.modal.term').waitFor();
 await page.locator('.modal.term button.close').click();
 await page.waitForFunction(()=>!document.querySelector('.backdrop') && window.__office.player.enabled && window.__office.player.hasMouse);
 check('Click opens the highlighted terminal and close restores mouse-look');
 assert.deepEqual(errors,[]);
 writeFileSync(path.join(output,'checks.json'),JSON.stringify(checks,null,2));
} finally {await browser?.close();await office.shutdown();rmSync(dir,{recursive:true,force:true});}
