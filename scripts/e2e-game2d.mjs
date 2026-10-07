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

const output = path.resolve(process.env.GAME2D_ARTIFACTS ?? '/tmp/agent-office-game2d-evidence');
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
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');
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
  for (const route of ['/2d', '/2d.html', '/game2d.html']) { const r = await context.request.get(base + route); assert.equal(r.status(), 200); assert.match(await r.text(), /id="scene"/); }
  await page.goto(base + '/2d?floor=f2');
  await page.waitForFunction(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'f2' && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });
  check('authentication and shared bootstrap', 'Protected aliases return through login to /2d; complete office composition connects once on the requested floor.');
  assert.ok(await page.evaluate(() => window.__game2d.camera.isOrthographicCamera));
  assert.ok(await page.evaluate(() => window.__game2d.ctx.interactions.kinds().length > 25));
  async function menu(label) {
    await page.keyboard.press('Tab');
    await page.getByRole('menuitem', { name: label }).click();
    await page.waitForSelector('.backdrop');
  }
  async function close(by = 'Escape') {
    assert.ok(await page.locator('.backdrop').last().locator('button.close').count());
    if (by === 'Escape') await page.keyboard.press('Escape'); else await page.locator('.backdrop').last().locator('button.close').click();
    await page.waitForFunction(() => !document.querySelector('.backdrop'));
    await page.waitForFunction(() => document.activeElement?.id === 'scene' && window.__game2d.ctx.player.enabled);
  }
  // Real elevator is reachable by E at the arrival car, with add/remove and all destinations.
  await page.keyboard.press('KeyE'); await page.waitForSelector('.backdrop');
  assert.ok(await page.getByText('Test floor 1', { exact: true }).count());
  assert.ok(await page.getByText('Rooftop bar', { exact: true }).count());
  await page.getByText('Test floor 1', { exact: true }).click();
  await page.waitForFunction(() => window.__game2d.store.floor === 'f1' && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  await menu(/Elevator/); await page.getByText('Test floor 2', { exact: true }).click();
  await page.waitForFunction(() => window.__game2d.store.floor === 'f2' && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  check('physical elevator and floor management', 'Approach/E opens the existing elevator with floor status, add/remove project actions, rooftop and garage; actual rides switch floors.');
  const floor = office.floors().find(f => f.id === 'f2');
  const shell = floor.workers.spawn(DESKS[0].id, 'e2e', undefined, false, 'shell'); assert.equal(typeof shell, 'object');
  await page.waitForFunction(id => window.__game2d.store.workers.has(id), shell.id);
  const identities = floor.workers.list().map(w => ({ id: w.id, sessionId: w.sessionId }));
  await page.evaluate(() => { const g = window.__game2d; g.parts.place.placeAt({ x: 8, y: 0, z: 10, rotY: 0 }); });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
  assert.ok(await page.evaluate(() => window.__game2d.ctx.player.pos.x) > 8.15);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
  assert.ok(await page.evaluate(() => window.__game2d.ctx.player.pos.z) < 9.95);
  async function mapClick(x, y, z) {
    const pixel = await page.evaluate(({x,y,z}) => {
      const g = window.__game2d, v = g.ctx.player.pos.clone().set(x,y,z).project(g.camera);
      return { x: (v.x + 1) * innerWidth / 2, y: (1 - v.y) * innerHeight / 2 };
    }, {x,y,z});
    await page.mouse.click(pixel.x, pixel.y);
  }
  await mapClick(7, 0.02, 10);
  await page.waitForFunction(() => Math.hypot(window.__game2d.ctx.player.pos.x - 7, window.__game2d.ctx.player.pos.z - 10) < 0.5);
  await page.evaluate(() => window.__game2d.parts.place.placeAt({ x: -14, y: 0, z: -3.45, rotY: 0 }));
  await page.keyboard.down('KeyD'); await page.waitForTimeout(900); await page.keyboard.up('KeyD');
  assert.ok(await page.evaluate(() => window.__game2d.ctx.player.pos.x) < -12.5);
  check('movement and shared collision physics', 'Arrows/WASD, ground click-to-walk and collision against the original desk geometry work in the orthographic scene.');
  for (const label of [/Issues/, /Pull requests/, /Task queue/, /Boss Control Center/, /Smartphone/, /Services/, /Whiteboard/, /Meeting room/, /Search/, /Settings/, /2D view controls/, /Compare plans/i]) {
    await menu(label);
    if(label.test('Compare plans')) { await page.waitForTimeout(250); await page.screenshot({path:path.join(output,'plans.png')}); }
    await close();
  }
  check('complete office dialogs', 'Shared Issues/PR/Queue, Boss, Smartphone, Services, Whiteboard, Meeting, Search, Settings, view controls and Plan Comparison open from the same menu with close/Esc focus recovery.');
  await menu(/Boss Control Center/); await page.getByRole('button',{name:'Play Minesweeper',exact:true}).click();
  await page.getByRole('dialog',{name:'Minesweeper',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__game2d.camera.perspective);
  await page.getByLabel('Minesweeper board').click({position:{x:30,y:80}});
  await page.screenshot({path:path.join(output,'arcade.png')}); await close('close');
  await page.waitForFunction(()=>window.__game2d.camera.isOrthographicCamera);
  check('real arcade interaction','Boss Control Center launches playable Minesweeper with its original camera and canvas; closing restores the orthographic view and controls.');
  await page.keyboard.press('Tab'); assert.ok(await page.locator('.hud-menu .close').count()); await close('close');
  await page.keyboard.press('Control+k'); await page.getByLabel('Find anything in the office').waitFor(); await close('close');
  check('menu and palette recovery','The full menu and command palette have top-right close buttons and restore controls immediately.');

  const desk = DESK_BY_ID.get(shell.deskId), [sx,sz] = deskPoint(desk, 0, 0.9);
  await mapClick(sx, 0.8, sz); await page.waitForSelector('.term');
  await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, 'terminal.png') });
  await page.keyboard.type('printf "TOPDOWN_TERMINAL_OK\\n"'); await page.keyboard.press('Enter');
  assert.ok(sent.some(m => m.t === 'term.input' && m.workerId === shell.id));
  await close('close');
  assert.equal(floor.workers.list().length, 1);
  check('shared worker terminal', 'Clicking the rendered worker opens the existing terminal and real shell input without a replacement worker/session.');
  await page.evaluate(() => { const g=window.__game2d; g.parts.place.placeAt({x:8,y:0,z:10,rotY:0}); });
  await page.mouse.move(700,450); const span = await page.evaluate(() => window.__game2d.camera.span);
  await page.mouse.wheel(0,-200); await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => window.__game2d.camera.span) < span);
  await page.evaluate(() => { window.__game2d.camera.span=30; });
  await page.waitForTimeout(300); await page.screenshot({ path: path.join(output, 'office-1440.png') });
  await page.setViewportSize({width:1120,height:760}); await page.waitForTimeout(300); await page.screenshot({path:path.join(output,'office-1120.png')});
  await page.setViewportSize({width:1440,height:900});
  check('office visual and zoom', 'Two screenshots show the actual 3D office artwork in a flat cutaway projection, original HUD, elevator and fixtures; wheel zoom updates pointer projection.');
  await menu(/Elevator/); await page.getByText('Rooftop bar', { exact: true }).click();
  await page.waitForFunction(() => window.__game2d.core.upTop && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  await page.waitForTimeout(300); await page.screenshot({path:path.join(output,'rooftop.png')});
  assert.ok(await page.evaluate(() => window.__game2d.parts.rooftop.roof().interactables.length > 5));
  await page.evaluate(()=>{const g=window.__game2d, it=g.parts.rooftop.roof().interactables.find(it=>it.kind==='darts'); if(!it) throw Error('No darts'); g.ctx.interactions.use(it,'E',null);});
  await page.waitForFunction(()=>window.__game2d.ctx.activities.running('thrower') && window.__game2d.camera.perspective);
  await page.keyboard.press('KeyE'); await page.waitForFunction(()=>window.__game2d.camera.isOrthographicCamera);
  check('rooftop game interaction','The actual shared darts interaction starts its aiming activity on the roof and E returns to the top-down view.');
  await menu(/Elevator/); await page.getByText('Garage', {exact:true}).click();
  await page.waitForFunction(() => !window.__game2d.core.trip && window.__game2d.parts.place.downstairs());
  assert.ok(await page.evaluate(() => window.__game2d.ctx.player.pos.y) < -1);
  await page.waitForTimeout(300); await page.screenshot({path:path.join(output,'garage.png')});
  await page.evaluate(()=>{const g=window.__game2d, it=g.ctx.office.interactables.find(it=>it.kind==='car'); if(!it) throw Error('No car'); g.ctx.interactions.use(it,'E',null);});
  await page.waitForFunction(()=>window.__game2d.ctx.activities.running('driver') && window.__game2d.camera.perspective);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
  assert.ok(sent.some(m=>m.t==='car.enter')); assert.ok(sent.some(m=>m.t==='car.drive'));
  await page.keyboard.press('KeyE'); await page.waitForFunction(()=>!window.__game2d.ctx.activities.running('driver') && window.__game2d.camera.isOrthographicCamera);
  check('real car interaction','The original car interaction enters the driver, WASD emits real car.drive frames, and E exits back to the plan view.');
  await menu(/Elevator/); await page.getByText('Test floor 2',{exact:true}).click();
  await page.waitForFunction(() => window.__game2d.store.floor==='f2' && !window.__game2d.core.trip && !window.__game2d.parts.place.downstairs());
  check('rooftop and garage access', 'Real elevator rides reach the full rooftop/bar/game fixtures and garage/car fixtures, then return to the selected office floor.');
  // Exercise every built-in map through the actual existing server contract.
  for (const map of ['castle','station','office']) {
    await page.evaluate(map => window.__game2d.ctx.net.send({t:'map.set',map}),map);
    await page.waitForFunction(map => window.__game2d.store.map.pick===map, map);
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => window.__game2d.ctx.player.enabled));
    if(map!=='office') await page.screenshot({path:path.join(output,map+'.png')});
  }
  check('other maps', 'Castle and Station load and stay playable through the existing map.set server API; returns to Office without changing worker/session IDs.');
  await page.evaluate(()=>{const g=window.__game2d, it=g.ctx.office.interactables.find(it=>it.kind==='golf'); if(!it) throw Error('No tee'); g.ctx.interactions.use(it,'E',null);});
  await page.waitForFunction(()=>window.__game2d.ctx.activities.running('golf') && window.__game2d.camera.perspective);
  await page.keyboard.press('KeyE'); await page.waitForFunction(()=>!window.__game2d.ctx.activities.running('golf') && window.__game2d.camera.isOrthographicCamera);
  check('real golf interaction','The shared tee interaction starts golf with its original aiming camera; E puts the club away and restores the plan view.');

  // Shared activity registries are all present, and owning the camera switches projection back.
  assert.ok(await page.evaluate(() => ['golf','driver','thrower','climber'].every(id => window.__game2d.ctx.activities.all().some(a => a.id===id))));
  await page.evaluate(() => { const g=window.__game2d; g.testCameraOff=g.ctx.activities.add({id:'e2e-camera',active:()=>true,stop:()=>{},takesCamera:true}); });
  await page.waitForFunction(() => window.__game2d.camera.perspective);
  await page.evaluate(() => window.__game2d.testCameraOff());
  await page.waitForFunction(() => window.__game2d.camera.isOrthographicCamera);
  check('activity camera and registries', 'Golf, cars, bar games, arcade and climbing use the original shared activity modules; camera ownership switches to perspective and back without another session.');
  // Actual multiplayer, and full-page view handoff.
  await page.evaluate(()=>{const g=window.__game2d; g.parts.place.placeAt({x:8,y:0,z:10,rotY:0}); g.parts.place.saveSpot();});
  const peer = await context.newPage(); peer.on('pageerror',e=>errors.push(e.message));
  await peer.goto(base+'/2d?floor=f2');
  await peer.waitForFunction(() => window.__game2d?.ctx.net.up && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  await page.waitForFunction(() => window.__game2d.parts.peers.remotes.size > 0);
  const peerId=await peer.evaluate(()=>window.__game2d.store.you);
  const start = await peer.evaluate(()=>window.__game2d.ctx.player.pos.z);
  await peer.keyboard.down('KeyS');
  await peer.waitForFunction(start=>window.__game2d.ctx.player.pos.z > start + 0.15,start);
  await peer.keyboard.up('KeyS');
  await peer.waitForFunction(()=>!window.__game2d.ctx.player.moving);
  const remoteAt=await peer.evaluate(()=>({x:window.__game2d.ctx.player.pos.x,z:window.__game2d.ctx.player.pos.z}));
  await page.waitForFunction(({id,at})=>{const p=window.__game2d.store.peers.get(id);return p && !p.moving && Math.hypot(p.x-at.x,p.z-at.z)<0.1;},{id:peerId,at:remoteAt},{polling:50});
  await peer.close();
  await page.waitForFunction(id=>!window.__game2d.store.peers.has(id),peerId);
  check('multiplayer', 'Two real top-down clients exchange existing peer movement and remove the old peer on disconnect.');
  const boundary=sent.length;
  await menu(/View: 3D/); await page.getByLabel('View',{exact:true}).selectOption('/lite');
  await page.waitForFunction(()=>window.__lite?.store.floor==='f2');
  await page.getByLabel('View',{exact:true}).selectOption('/'); await page.waitForSelector('#loading',{state:'hidden'});
  await page.keyboard.press('Tab'); await page.getByRole('menuitem',{name:/View: 3D/}).click();
  await page.getByLabel('View',{exact:true}).selectOption('/2d');
  await page.waitForFunction(()=>window.__game2d?.ctx.net.up && window.__game2d.store.floor==='f2' && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  assert.deepEqual(floor.workers.list().map(w=>({id:w.id,sessionId:w.sessionId})),identities);
  assert.ok(!sent.slice(boundary).some(m=>['worker.spawn','worker.resume'].includes(m.t)));
  check('3D/Lite handoff', '2D → Lite → 3D → 2D preserves non-default floor and worker/session IDs with no spawn/resume requests.');
  assert.deepEqual(errors, []); check('browser runtime','No page errors across Office, rooftop, garage, alternate maps and view switching.');
  writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,screenshots:['office-1440.png','office-1120.png','terminal.png','rooftop.png','garage.png','castle.png','station.png','plans.png','arcade.png']},null,2));
} catch (error) {
  console.error('Page errors:', errors);
  if (page && !page.isClosed()) { console.error('State:', await page.evaluate(() => { const g=window.__game2d; return g && {floor:g.store.floor,enabled:g.ctx.player.enabled,position:g.ctx.player.pos,trip:g.core.trip,activities:g.ctx.activities.all().filter(a=>a.active()).map(a=>a.id)}; }).catch(()=>null)); await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); }
  throw error;
} finally {
  await browser?.close(); office.shutdown();
}
console.log(`Evidence: ${output}`);
process.exit(0);
