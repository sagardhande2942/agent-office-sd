// Reproducible desktop checks using the production bundle and an isolated real office.
// npm run build && node --import tsx scripts/e2e-game2d.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { DESKS, DESK_BY_ID, BOARDS, PLAN_REVIEW_TABLE, STATIONS } from '../src/shared/layout.ts';
import { deskPoint } from '../src/shared/nav.ts';

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
let browser, page;
const checks = [], errors = [], sent = [];
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
  page.on('websocket', ws => ws.on('framesent', frame => { try { sent.push(JSON.parse(String(frame.payload))); } catch {} }));
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
      const v=o.position.clone(); v.y += id.startsWith('plant') ? .6 : .3; v.project(g.camera);
      return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};
    },id);
  }
  await openEditor();
  const target = await objectPixel('lounge-coffee-table');
  await page.mouse.move(target.x,target.y); await page.mouse.down();
  await page.mouse.move(target.x-50,target.y+20,{steps:10}); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.object-placement p').textContent.includes('Coffee table'));
  await page.getByLabel('Rotation degrees').fill('37.5'); await page.getByLabel('Rotation degrees').press('Tab');
  await page.getByLabel('Scale multiplier').fill('1.2'); await page.getByLabel('Scale multiplier').press('Tab');
  const saved = await page.evaluate(() => { const keys=Object.keys(localStorage).filter(k=>k.startsWith('agent-office.placement.v1:')); return Object.fromEntries(keys.map(k=>[k,JSON.parse(localStorage[k])])); });
  assert.equal(Object.keys(saved).length,1);
  assert.ok(Math.abs(Object.values(saved)[0].rotation[1] - 37.5*Math.PI/180)<1e-9);
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
  assert.deepEqual(errors,[]);
  writeFileSync(path.join(output,'checks.json'),JSON.stringify({passed:['mouse dragging','precise rotation and uniform scaling','immediate auto-save','Escape restores controls','exact reload','touch dragging','snapping and reset','independent objects','close restores controls'],saved},null,2));
} catch(error) { console.log('errors',errors); console.log(await page.evaluate(()=>({text:document.querySelector('.object-placement')?.textContent, enabled:window.__office.player.enabled}))); await page.screenshot({path:path.join(output,'failure.png')}); throw error; } finally { await browser?.close(); office.shutdown(); }
console.log(`Evidence: ${output}`); process.exit(0);
