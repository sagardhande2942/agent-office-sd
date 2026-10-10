// Reproducible desktop checks using the production bundle and an isolated real office.
// npm run build && node --import tsx scripts/e2e-object-placement.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = path.resolve(process.env.PLACEMENT_ARTIFACTS ?? path.join(os.tmpdir(), 'agent-office-placement-evidence'));
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-game2d-'));
const floors = ['f1', 'f2'].map((id, i) => {
  const checkout = path.join(dir, id); mkdirSync(checkout);
  execFileSync('git', ['init', '-b', 'main'], { cwd: checkout, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: checkout, stdio: 'ignore' });
  return { id, name: `Test floor ${i + 1}`, dir: checkout, palette: i, addedBy: 'test', addedAt: Date.now() };
});
const data = path.join(dir, '.agent-office'); mkdirSync(data);
writeFileSync(path.join(data, 'floors.json'), JSON.stringify(floors));
const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'game2d-test', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome'));
let browser, page, observer;
const checks = [], errors = [];
const check = (name, evidence) => { checks.push({ name, status: 'passed', evidence }); console.log(`PASS ${name}: ${evidence}`); };
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: '2D tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/2d');
  await page.waitForURL('**/login?next=/2d');
  const response = await context.request.post(base + '/api/login', { data: { password: 'game2d-test' } }); assert.ok(response.ok());
  await page.goto(base + '/2d?floor=f2');
  await page.waitForFunction(() => window.__office?.store.floor === 'f2' && window.__office.player.enabled);
  async function openEditor() {
    await page.getByRole('button', {name:'Menu', exact:true}).click();
    await page.getByRole('menuitem', {name:'Customize objects'}).click();
    await page.waitForSelector('.object-placement');
  }
  async function objectPixel(id) {
    return page.evaluate(id => {
      const g = window.__office; let o;
      g.office.group.traverse(p => { if(p.userData.editable?.id === id) o=p; });
      const v=o.position.clone(); v.y += id.startsWith('plant') ? (g.camera.isOrthographicCamera ? .6 : .2) : .3; v.project(g.camera);
      return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};
    },id);
  }
  const observerContext = await browser.newContext({viewport:{width:1440,height:900}});
  await observerContext.addInitScript(() => localStorage.setItem('agent-office.profile',JSON.stringify({name:'Observer',color:'#06d6a0',look:{skin:0,hair:0,style:0}})));
  assert.ok((await observerContext.request.post(base+'/api/login',{data:{password:'game2d-test'}})).ok());
  observer=await observerContext.newPage(); observer.on('pageerror',e=>errors.push(e.message));
  await observer.goto(base+'/?floor=f2');
  await observer.waitForFunction(()=>window.__office?.store.floor==='f2' && window.__office.player.enabled);
  const observerTable=()=>observer.evaluate(()=>{
    let t; window.__office.office.group.traverse(o=>{if(o.userData.editable?.id==='lounge-coffee-table') t={position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()};});return t;
  });
  await openEditor();
  assert.equal(await page.evaluate(()=>window.__office.player.enabled),false,'2D retains stationary editing');
  const target = await objectPixel('lounge-coffee-table');
  await page.mouse.move(target.x,target.y); await page.mouse.down();
  await page.mouse.move(target.x-50,target.y+20,{steps:10});
  await observer.waitForFunction(()=>{let moved=false;window.__office.office.group.traverse(o=>{if(o.userData.editable?.id==='lounge-coffee-table') moved=Math.abs(o.position.x-13)>.2;});return moved;});
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.object-placement p').textContent.includes('Coffee table'));
  await page.getByLabel('Rotation degrees').fill('37.5'); await page.getByLabel('Rotation degrees').press('Tab');
  await page.getByLabel('Scale multiplier').fill('1.2'); await page.getByLabel('Scale multiplier').press('Tab');
  const saved = await page.evaluate(() => { const keys=Object.keys(localStorage).filter(k=>k.startsWith('agent-office.placement.v1:')); return Object.fromEntries(keys.map(k=>[k,JSON.parse(localStorage[k])])); });
  assert.equal(Object.keys(saved).length,1);
  assert.ok(Math.abs(Object.values(saved)[0].rotation[1] - 37.5*Math.PI/180)<1e-9);
  await observer.waitForFunction(()=>{let matches=false;window.__office.office.group.traverse(o=>{if(o.userData.editable?.id==='lounge-coffee-table') matches=Math.abs(o.rotation.y-37.5*Math.PI/180)<1e-9 && Math.abs(o.scale.x-1.2)<1e-9;});return matches;});
  await page.waitForFunction(()=>document.querySelector('.object-placement p').textContent.includes('saved to shared office'));
  assert.deepEqual(await observerTable(),Object.values(saved)[0]);
  await observer.evaluate(()=>{const p=window.__office.player;p.pos.set(15,0,5);p.camYaw=.38;p.lookPitch=-.2;p.updateCamera(true);});
  await observer.screenshot({path:path.join(output,'object-placement-observer-3d.png')});
  const lateContext=await browser.newContext();
  await lateContext.addInitScript(()=>localStorage.setItem('agent-office.profile',JSON.stringify({name:'Late joiner',color:'#ffd166',look:{skin:0,hair:0,style:0}})));
  assert.ok((await lateContext.request.post(base+'/api/login',{data:{password:'game2d-test'}})).ok());
  const late=await lateContext.newPage();await late.goto(base+'/2d?floor=f2');
  await late.waitForFunction(()=>window.__office?.store.floor==='f2' && window.__office.store.placements.items['lounge-coffee-table']?.scale[0]===1.2);
  assert.deepEqual(await late.evaluate(()=>window.__office.store.placements.items['lounge-coffee-table']),Object.values(saved)[0]);
  await lateContext.close();
  await observer.goto(base+'/2d?floor=f1');await observer.waitForFunction(()=>window.__office?.store.floor==='f1');
  await observer.waitForFunction(()=>{let defaults=false;window.__office.office.group.traverse(o=>{if(o.userData.editable?.id==='lounge-coffee-table') defaults=o.position.x===13&&o.scale.x===1;});return defaults;});
  await observer.goto(base+'/?floor=f2');await observer.waitForFunction(()=>window.__office?.store.floor==='f2'&&window.__office.store.placements.items['lounge-coffee-table']?.scale[0]===1.2);
  check('shared placement','Observer sees live dragging before release, rotation/scale match exactly, fresh browser receives snapshot, other floors stay independent');
  await page.screenshot({path:path.join(output,'object-editor.png')});
  await page.keyboard.press('Escape'); await page.waitForFunction(()=>window.__office.player.enabled);
  await page.reload(); await page.waitForFunction(()=>window.__office?.store.floor==='f2' && window.__office.player.enabled);
  const actual=await page.evaluate(()=> { let t; window.__office.office.group.traverse(o=> {if(o.userData.editable?.id==='lounge-coffee-table') t={position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()};}); return t; });
  assert.deepEqual(actual,Object.values(saved)[0]);
  await openEditor();
  const plant = await objectPixel('plant-5');
  // Touch uses the same captured pointer path as mouse.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:plant.x,y:plant.y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:plant.x+25,y:plant.y+5}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('.object-placement p').textContent.includes('Potted plant'));
  await page.getByRole('button',{name:'Rotate',exact:true}).click();
  await page.getByRole('checkbox').click();
  await page.getByLabel('Rotation degrees').fill('23'); await page.getByLabel('Rotation degrees').press('Tab');
  assert.ok(Math.abs(Number(await page.getByLabel('Rotation degrees').inputValue())-30)<1e-6);
  await page.getByRole('button',{name:'Reset Transform',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.waitForFunction(()=>window.__office.player.enabled);
  const tableRecord = await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.endsWith(':lounge-coffee-table'))[1]);
  assert.deepEqual(JSON.parse(tableRecord),actual);
  // Real perspective-camera navigation while the scene editor owns the cursor.
  await page.goto(base + '/?floor=f2');
  await page.waitForFunction(()=>window.__office?.store.floor==='f2' && window.__office.player.enabled);
  const pose = () => page.evaluate(()=> {
    const p=window.__office.player; p.setView('first'); p.pos.set(-6,0,5);
    p.camYaw=0; p.lookPitch=-.25; p.clearKeys(); p.updateCamera(true);
  });
  const position = () => page.evaluate(()=>window.__office.player.pos.toArray());
  const transform = () => page.evaluate(()=> {
    const o=window.__office.office.plants[5];
    return {position:o.position.toArray(),rotation:o.rotation.toArray(),scale:o.scale.toArray()};
  });
  await pose(); await openEditor();
  await page.waitForFunction(()=>window.__office.player.enabled && !window.__office.player.canLock && !document.pointerLockElement);
  const beforeWalk=await position();
  await page.keyboard.down('KeyA'); await page.waitForTimeout(300); await page.keyboard.up('KeyA');
  const afterWalk=await position(); assert.ok(Math.abs(afterWalk[0]-beforeWalk[0])>.3);
  const beforeLook=await page.evaluate(()=>window.__office.player.camYaw);
  const beforeLookObject=await transform();
  await page.mouse.move(180,250); await page.mouse.down({button:'right'});
  await page.mouse.move(260,280,{steps:8}); await page.mouse.up({button:'right'});
  assert.ok(Math.abs(await page.evaluate(()=>window.__office.player.camYaw)-beforeLook)>.1);
  assert.deepEqual(await transform(),beforeLookObject);
  assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false);
  await pose(); await page.waitForTimeout(100);
  const heldPixel=await objectPixel('plant-5');
  await page.mouse.move(heldPixel.x,heldPixel.y); await page.mouse.down();
  await page.waitForFunction(()=>document.querySelector('.object-placement p').textContent.includes('Potted plant'));
  const heldStart=await transform(), playerStart=await position();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(350); await page.keyboard.up('KeyW');
  const heldEnd=await transform(), playerEnd=await position(); await page.mouse.up();
  assert.ok(Math.abs(playerEnd[2]-playerStart[2])>.3);
  assert.ok(Math.abs(heldEnd.position[2]-heldStart.position[2])>.3,'held object follows walking with stationary cursor');
  assert.ok(Math.abs(await page.evaluate(()=>window.__office.player.camYaw))<1e-6,'left drag does not turn camera');
  await page.getByLabel('Rotation degrees').focus();
  const beforeTyping=await position();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(180); await page.keyboard.up('KeyW');
  assert.deepEqual(await position(),beforeTyping);
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__office.player.enabled),false);
  const beforeMenuWalk=await position();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(180); await page.keyboard.up('KeyW');
  assert.deepEqual(await position(),beforeMenuWalk);
  await page.locator('.hud-menu .close').click();
  await page.waitForFunction(()=>window.__office.player.enabled);
  await page.evaluate(()=>window.__office.player.setView('third'));
  const thirdYaw=await page.evaluate(()=>window.__office.player.camYaw);
  await page.mouse.move(180,250); await page.mouse.down({button:'right'});
  await page.mouse.move(240,270,{steps:6}); await page.mouse.up({button:'right'});
  assert.ok(Math.abs(await page.evaluate(()=>window.__office.player.camYaw)-thirdYaw)>.1);
  await page.screenshot({path:path.join(output,'object-editor-3d-movement.png')});
  await page.evaluate(()=>window.__office.player.setView('first'));
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.waitForFunction(()=>window.__office.player.enabled && window.__office.player.canLock && !!document.pointerLockElement);
  await page.evaluate(()=>window.__office.player.unlock());
  await page.waitForFunction(()=>!document.pointerLockElement);
  await openEditor(); await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.__office.player.enabled && window.__office.player.canLock && !!document.pointerLockElement);
  check('3D editor navigation','WASD walking, first-person right-drag, third-person orbit, walking during object drag, input/menu guards and mouse-look restoration');
  const expectedRestart=await observerTable();
  await new Promise(resolve=>{office.server.once('close',resolve);office.shutdown();});
  const restored=await startServer(cfg,{publicDir:path.resolve('dist/public')});
  try {
    const restoredBase=`http://127.0.0.1:${restored.server.address().port}`;
    const clean=await browser.newContext();
    await clean.addInitScript(()=>localStorage.setItem('agent-office.profile',JSON.stringify({name:'Restart verifier',color:'#ef476f',look:{skin:0,hair:0,style:0}})));
    assert.ok((await clean.request.post(restoredBase+'/api/login',{data:{password:'game2d-test'}})).ok());
    const restarted=await clean.newPage();await restarted.goto(restoredBase+'/2d?floor=f2');
    await restarted.waitForFunction(()=>window.__office?.store.floor==='f2'&&window.__office.player.enabled);
    const restoredTable=await restarted.evaluate(()=>window.__office.store.placements.items['lounge-coffee-table']);
    assert.deepEqual(restoredTable,expectedRestart);
    await clean.close();check('server restart','A fresh browser on a new office server instance receives the exact persisted transform');
  } finally { restored.shutdown(); }
  assert.deepEqual(errors,[]);
  writeFileSync(path.join(output,'checks.json'),JSON.stringify({passed:['mouse dragging','precise rotation and uniform scaling','immediate auto-save','Escape restores controls','exact reload','touch dragging','snapping and reset','independent objects','close restores controls',...checks.map(c=>c.name)],saved},null,2));
} catch(error) { console.log('errors',errors); console.log(await page.evaluate(()=>({text:document.querySelector('.object-placement')?.textContent, enabled:window.__office.player.enabled}))); await page.screenshot({path:path.join(output,'failure.png')}); throw error; } finally { await browser?.close(); office.shutdown(); }
console.log(`Evidence: ${output}`); process.exit(0);
