// Verify real controls and networked shot values; draw selected frames for visual evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
const output = '/tmp/agent-office-tabletennis-shots'; mkdirSync(output, { recursive: true });
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
   const send = o.ctx.net.send.bind(o.ctx.net); o.ctx.net.send = m => { if (m.t === 'pingpong.serve' || m.t === 'pingpong.hit') window.__sent.push(structuredClone(m)); send(m); };
  }); return p;
 };
 const page = await load(), observer = await load(); await page.bringToFront();
 const play = async () => {
  await page.evaluate(() => {
   const o = window.__office; o.player.pos.set(6, 0, 13.5); o.player.camYaw = Math.PI; o.player.lookPitch = -0.15; o.player.hasMouse = true; o.player.enabled = true;
   o.ctx.interactions.use(o.office.tableTennis.group.userData.interact, 'E', undefined);
  });
  await page.locator('.tabletennis-modal').waitFor(); await page.getByRole('button', { name: /Start Match vs Worker Bot/ }).click();
  await page.locator('.tt-shot-hud').waitFor(); await page.waitForFunction(() => window.__office.store.pingpong.status === 'serve'); await page.locator('canvas').focus();
 };
 const leave = async () => { await page.keyboard.press('KeyE'); await page.waitForFunction(() => !window.__office.store.pingpong.active); };
 await play();
 assert.ok(await page.evaluate(() => window.__office.camera.fov >= 75 && window.__office.camera.position.y >= 2.5)); check('Table tennis uses a wide elevated court view');
 const feetBefore = await page.evaluate(() => window.__office.player.pos.toArray());
 await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500); await page.keyboard.up('ArrowLeft');
 const left = await page.evaluate(() => ({ feet: window.__office.player.pos.toArray(), target: window.__office.scene.getObjectByName('tabletennis-shot-target').position.toArray() }));
 assert.deepEqual(left.feet, feetBefore); assert.ok(left.target[2] < 15); check('Aim moves the landing target without moving the player');
 await page.keyboard.down('Space'); await page.waitForTimeout(60);
 assert.equal(await page.evaluate(() => window.__sent.length), 0); check('Holding a shot does not fire it before release');
 await page.keyboard.up('Space'); await page.waitForFunction(() => window.__sent.length > 0 && window.__shots.length > 0);
 const tap = await page.evaluate(() => window.__sent[0]);
 await observer.waitForFunction(() => window.__shots.length > 0);
 const received = await observer.evaluate(() => window.__shots[0]);
 for (const k of ['vx', 'vy', 'vz']) assert.equal(received[k], tap[k]); assert.deepEqual(received.swing, tap.swing); assert.ok(received.vz < 0);
 check('A second connected browser receives the same angled velocity and spin');
 await leave(); await play();
 await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight');
 const right = await page.evaluate(() => window.__office.scene.getObjectByName('tabletennis-shot-target').position.z);
 assert.ok(right > 15); check('Both left and right landing directions are available');
 await page.keyboard.down('Space'); await page.waitForTimeout(950);
 assert.equal(await page.getByRole('progressbar', { name: 'Shot power' }).getAttribute('aria-valuenow'), '100');
 await page.evaluate(() => { window.__drawFrames = true; }); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(output, 'charged-shot-desktop.png') });
 await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { window.__drawFrames = true; }); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(output, 'charged-shot-mobile.png') }); await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => { window.__drawFrames = false; });
 await page.keyboard.up('Space'); await page.waitForFunction(() => window.__sent.length >= 2);
 const hard = await page.evaluate(() => window.__sent[1]); assert.ok(hard.vz > 0); assert.ok(hard.vx > tap.vx * 1.4); check('Full charge produces greater shot pace than a tap');
 await leave(); await play();
 await page.keyboard.down('Space'); await page.waitForTimeout(150); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('Space');
 assert.equal(await page.evaluate(() => window.__sent.length), 2); check('Losing window focus cancels a held shot');
 await page.bringToFront(); await page.locator('canvas').focus(); await page.waitForTimeout(200);
 const canvas = await page.locator('canvas').boundingBox();
 await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
 await page.waitForFunction(() => window.__sent.length >= 3); assert.equal(await page.evaluate(() => window.__sent.length), 3); check('Mouse release sends one shot without duplicate click handlers');
 await leave(); await page.waitForTimeout(100); assert.ok(await page.evaluate(() => window.__office.camera.fov < 70)); check('Leaving restores normal office field of view'); assert.deepEqual(errors, []);
 writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, browserErrors: errors, tap: { vx: tap.vx, vz: tap.vz }, charged: { vx: hard.vx, vz: hard.vz } }, null, 2));
 console.log(`Evidence: ${output}`);
} finally { await browser?.close(); office.shutdown(); }
process.exit(0);
