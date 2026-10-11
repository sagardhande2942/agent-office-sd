// Verify real controls and networked shot values; draw selected frames for visual evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
const output = '/tmp/agent-office-tabletennis-watch'; mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-tt-shots-'));
const cfg = loadConfig([dir, '--password', 'shot-test', '--no-open']); cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executablePath = path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');
const checks = [], errors = []; let browser;
const check = name => { checks.push(name); console.log('PASS ' + name); };
try {
 browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
 await context.addInitScript(() => {
  localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Shot tester', color: '#3b82f6', look: { skin: 0, hair: 0, style: 0 } }));
  const raf = requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(ts => {
   const o = window.__office;
   if (o?.renderer && !window.__drawingInstalled) {
    window.__drawingInstalled = true; const draw = o.renderer.render.bind(o.renderer);
    o.renderer.render = (...args) => { if (window.__drawFrames) draw(...args); };
   }
   cb(ts);
  });
 });
 await context.request.post(base + '/api/login', { data: { password: 'shot-test' } });
 const load = async () => {
  const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(base + '/?3d=1'); await p.waitForFunction(() => window.__office?.ctx && window.__office.player.enabled && window.__office.ctx.net.up);
  await p.waitForSelector('#loading', { state: 'hidden' });
  await p.evaluate(() => {
   const o = window.__office; window.__shots = []; window.__sent = [];
   o.ctx.messages.on('pingpong.hit', m => window.__shots.push(m));
   const send = o.ctx.net.send.bind(o.ctx.net); o.ctx.net.send = m => { if ((m.t === 'pingpong.serve' || m.t === 'pingpong.hit') && m.side === 'west') window.__sent.push(structuredClone(m)); send(m); };
  }); return p;
 };
 const page = await load(), observer = await load(); await page.bringToFront();
 const open = async p => {
  await p.evaluate(() => { const o = window.__office; o.player.pos.set(6, 0, 13.5); o.player.enabled = true; o.player.hasMouse = true; o.ctx.interactions.use(o.office.tableTennis.group.userData.interact, 'E', undefined); });
  await p.locator('.tabletennis-modal').waitFor();
 };
 await open(page);
 await page.getByLabel('West bot difficulty').selectOption('pro');
 await page.getByLabel('East bot difficulty').selectOption('normal');
 await page.getByRole('button', { name: 'Watch bots play', exact: true }).scrollIntoViewIfNeeded();
 await page.screenshot({ path: path.join(output, 'watch-bots-setup.png') });
 await page.evaluate(() => { window.__originalRandom = Math.random; Math.random = () => 0.5; });
 await page.getByRole('button', { name: 'Watch bots play', exact: true }).click();
 await page.waitForFunction(() => window.__office.store.pingpong.mode === 'bots' && window.__office.store.pingpong.active);
 const first = await page.evaluate(() => window.__office.store.pingpong);
 assert.equal(first.westPlayer.difficulty, 'pro'); assert.equal(first.eastPlayer.difficulty, 'normal');
 check('Watch bots play starts two bots with separate difficulty settings');
 await open(observer); await observer.getByRole('button', { name: 'Watch current bot match', exact: true }).click();
 await observer.waitForFunction(() => window.__office.store.pingpong.watcherIds.length === 2);
 await page.bringToFront();
 const joined = await observer.evaluate(() => ({ state: window.__office.store.pingpong, id: window.__office.store.you }));
 assert.notEqual(joined.state.operatorId, joined.id); assert.equal(joined.state.operatorId, first.operatorId);
 check('A second viewer watches the same exhibition without taking over');
 await page.waitForFunction(() => window.__shots.length >= 4 && window.__shots.some(m => m.side === 'east') && window.__shots.some(m => m.side === 'west'));
 await observer.waitForFunction(() => window.__shots.length >= 2 && window.__shots.some(m => m.side === 'east') && window.__shots.some(m => m.side === 'west'));
 check('Both bots return balls without human shot input and both viewers receive the rally');
 assert.equal(await page.locator('.tt-shot-hud').isVisible(), false);
 assert.equal(await page.evaluate(() => window.__office.scene.children.filter(o => o.name.startsWith('tabletennis-name-')).length), 2);
 check('Exhibition keeps the bats-and-names view without manual shot controls');
 await page.evaluate(() => { Math.random = () => 0; });
 await page.waitForFunction(() => window.__office.store.pingpong.score.west + window.__office.store.pingpong.score.east > 0);
 await page.evaluate(() => { Math.random = window.__originalRandom; window.__drawFrames = true; });
 await page.waitForTimeout(1200); await page.screenshot({ path: path.join(output, 'watch-bots-desktop.png') });
 await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(output, 'watch-bots-mobile.png') });
 await page.evaluate(() => { window.__drawFrames = false; });
 check('Points score automatically and the next serve starts without user input');
 await observer.bringToFront(); await observer.keyboard.press('KeyE');
 await page.waitForFunction(() => window.__office.store.pingpong.watcherIds.length === 1);
 assert.equal(await page.evaluate(() => window.__office.store.pingpong.active), true);
 check('A spectator can leave while the bots keep playing');
 await page.bringToFront(); await page.keyboard.press('KeyE');
 await observer.waitForFunction(() => !window.__office.store.pingpong.active);
 assert.deepEqual(errors, []); check('Operator exit stops the exhibition for everyone');
 writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, browserErrors: errors }, null, 2));
 console.log(`Evidence: ${output}`);
} finally { await browser?.close(); office.shutdown(); }
process.exit(0);
