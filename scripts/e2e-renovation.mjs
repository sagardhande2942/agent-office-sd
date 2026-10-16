// Focused renovation evidence: one rendered browser and an independent WebSocket observer.
// npm run build && node --import tsx scripts/e2e-renovation.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import WebSocket from 'ws';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output=process.env.RENOVATION_ARTIFACTS ?? '/tmp/agent-office-renovation-evidence';
mkdirSync(output,{recursive:true});
const home=mkdtempSync(path.join(os.tmpdir(),'renovation-office-'));
const dir=path.join(home,'project'); mkdirSync(dir);
execFileSync('git',['init','-b','main'],{cwd:dir,stdio:'ignore'});
execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-m','fixture'],{cwd:dir,stdio:'ignore'});
mkdirSync(path.join(home,'.agent-office'));
writeFileSync(path.join(home,'.agent-office/floors.json'),JSON.stringify([{id:'renovation',name:'Renovation workshop',dir,palette:0,addedBy:'test',addedAt:Date.now()}]));
const cfg=loadConfig(['--home',home,'--port','4600','--password','renovation-test','--no-open']); cfg.port=0;
const office=await startServer(cfg,{publicDir:path.resolve('dist/public')});
const base=`http://127.0.0.1:${office.server.address().port}`;
const cache=path.join(os.homedir(),'.cache/ms-playwright');
const executable=process.env.CHROMIUM_PATH ?? path.join(cache,readdirSync(cache).find(x=>x.startsWith('chromium-')),'chrome-linux64/chrome');
let browser, observer, page;
const received=[], errors=[], checks=[];
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
const wait=async predicate=>{
  const until=Date.now()+30000;
  while(!predicate()) { if(Date.now()>until) throw Error('Observer did not receive the layout'); await new Promise(resolve=>setTimeout(resolve,50)); }
};
try {
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(()=>{
    // Preserve a requested frame until Playwright composites its screenshot.
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,attributes){
      return getContext.call(this,type,type==='webgl'||type==='webgl2'?{...attributes,preserveDrawingBuffer:true}:attributes);
    };
    localStorage.setItem('agent-office.profile',JSON.stringify({name:'Renovator',color:'#ef476f',look:{skin:0,hair:0,style:0}}));
    localStorage.setItem('agent-office.lite-declined','1');
    // Keep real scene rendering affordable on CPU-only CI; simulation and input keep running.
    let office;
    Object.defineProperty(window,'__office',{get:()=>office,set:value=>{
      office=value; value.renderer.shadowMap.enabled=false; value.renderer.setPixelRatio(.5);
      value.office.scenic.group.parent.visible=false;
      const draw=value.renderer.render.bind(value.renderer);
      value.renderer.render=(scene,camera)=>{if(!window.__captureRenovation||scene!==value.scene||camera!==value.camera)return;window.__captureRenovation=false;draw(scene,camera);};
    }});
  });
  assert.ok((await context.request.post(base+'/api/login',{data:{password:'renovation-test'}})).ok());
  const cookie=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
  observer=new WebSocket(base.replace('http','ws')+'/ws?name=Observer&floor=renovation&skin=0&hair=0&style=0&color=%2306d6a0',{headers:{Cookie:cookie,Origin:base}});
  observer.on('error',error=>errors.push(error.message));
  observer.on('message',raw=>received.push(JSON.parse(raw)));
  await wait(()=>received.some(m=>m.t==='welcome'));
  page=await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/2d?floor=renovation');
  await page.waitForFunction(()=>window.__office?.store.floor==='renovation'&&window.__office.player.enabled&&window.__office.office.group.visible,null,{polling:100,timeout:30000});
  async function openEditor(){
    // DOM activation avoids GPU hit-testing stalls; the real menu and its registered action run.
    await page.getByRole('button',{name:'Menu',exact:true}).evaluate(el=>el.click());
    await page.getByLabel('Search office menu').fill('Renovation');
    await page.getByRole('menuitem',{name:'Renovation mode'}).evaluate(el=>el.click());
    await page.waitForSelector('.object-placement');
  }
  await openEditor(); check('registered renovation menu and object picker');
  const id='renovation-v1-desks-0';
  await page.getByLabel('Office object',{exact:true}).selectOption(id);
  for(const [label,value] of [['Position X','4'],['Position Z','0'],['Rotation degrees','90']]) {
    await page.getByLabel(label,{exact:true}).fill(value);
    await page.getByLabel(label,{exact:true}).press('Tab');
  }
  await wait(()=>received.some(m=>m.t==='placement.changed'&&m.id===id&&m.saved&&m.transform.position[0]===4&&Math.abs(m.transform.rotation[1]-Math.PI/2)<1e-6));
  check('independent observer receives saved desk movement and rotation');
  await page.getByLabel('Office object',{exact:true}).selectOption('lounge-coffee-table');
  await page.getByLabel('Position X',{exact:true}).fill('4');
  await page.getByLabel('Position Z',{exact:true}).fill('0');
  await page.getByLabel('Position Z',{exact:true}).press('Tab');
  await wait(()=>received.some(m=>m.t==='placement.changed'&&m.id==='lounge-coffee-table'&&m.saved&&m.transform.position[0]===4&&m.transform.position[2]===0));
  check('overlapping furniture placements are accepted');
  assert.equal(await page.evaluate(()=>window.__office.world().nav.walkable(13,0)),true);
  assert.equal(await page.evaluate(()=>window.__office.world().nav.walkable(4,0)),false);
  check('navigation uses moved furniture instead of the original table footprint');
  await page.getByRole('button',{name:'Close',exact:true}).evaluate(el=>el.click());
  await page.reload();
  await page.waitForFunction(()=>window.__office?.store.floor==='renovation'&&window.__office.store.placements.items['renovation-v1-desks-0']?.position[0]===4,null,{polling:100,timeout:30000});
  await openEditor(); await page.getByLabel('Office object',{exact:true}).selectOption(id);
  await page.evaluate(()=>window.__captureRenovation=true);
  await page.waitForFunction(()=>!window.__captureRenovation,null,{polling:100,timeout:30000});
  await page.screenshot({path:path.join(output,'renovation-2d.png')});
  check('shared layout survives reload; 2D editor screenshot captured');
  await page.keyboard.press('Escape');
  await page.goto(base+'/?floor=renovation&3d=1');
  await page.waitForFunction(()=>window.__office?.store.floor==='renovation'&&window.__office.player.enabled&&window.__office.office.group.visible,null,{polling:100,timeout:30000});
  await page.evaluate(()=>{const p=window.__office.player;p.pos.set(6,0,6);p.camYaw=.2;p.lookPitch=-.3;p.updateCamera(true);});
  await openEditor(); await page.getByLabel('Office object',{exact:true}).selectOption(id);
  const fits=()=>page.evaluate(()=>{const g=window.__office;const e=g.office.desks.get('desk-1').group.parent.userData.editable;const c=e.colliders[0];return g.player.fits((c.minX+c.maxX)/2,(c.minZ+c.maxZ)/2,0);});
  await page.waitForTimeout(150); assert.equal(await fits(),true);
  await page.getByLabel('Walk through furniture while renovating').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change'));});
  assert.equal(await fits(),false);
  await page.getByLabel('Walk through furniture while renovating').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change'));});
  await page.waitForTimeout(150); assert.equal(await fits(),true);
  await page.evaluate(()=>window.__captureRenovation=true);
  await page.waitForFunction(()=>!window.__captureRenovation,null,{polling:100,timeout:30000});
  assert.ok(await page.evaluate(()=>window.__office.renderer.info.render.calls>0));
  await page.screenshot({path:path.join(output,'renovation-3d.png')});
  await page.getByRole('button',{name:'Close',exact:true}).click({noWaitAfter:true});
  await page.waitForFunction(()=>window.__office.player.enabled&&window.__office.player.canLock&&!!document.pointerLockElement,null,{polling:100,timeout:30000});
  assert.equal(await fits(),false);
  await openEditor(); await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.__office.player.enabled&&!!document.pointerLockElement,null,{polling:100,timeout:30000});
  check('3D walk-through toggle, close button and Escape restore collisions and mouse-look');
  assert.deepEqual(errors,[]);
  writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));
  console.log(`Evidence: ${output}`);
} catch(error) {
  console.error(error);
  try { console.log(await page.evaluate(()=>document.body.innerText.slice(-1500))); await page.screenshot({path:path.join(output,'failure.png'),timeout:10000}); } catch {}
  throw error;
} finally { observer?.close(); await browser?.close(); office.shutdown(); }
process.exit(0);
