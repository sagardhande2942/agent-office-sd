// Reproducible desktop checks using the production bundle and an isolated real office.
// npm run build && node --import tsx scripts/e2e-game2d-graphics.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { DESKS } from '../src/shared/desks.ts';

const output = path.resolve(process.env.GAME2D_ARTIFACTS ?? '/tmp/agent-office-2d-graphics-evidence');
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
const checks = [], errors = [];
const check = (name, evidence) => { checks.push({ name, status: 'passed', evidence }); console.log(`PASS ${name}: ${evidence}`); };
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Graphics tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    // Freeze the animation loop for screenshots so SwiftShader can drain its GPU queue.
    const raf = window.requestAnimationFrame.bind(window);
    const pending = [];
    window.requestAnimationFrame = fn => raf(time => { if (window.__freeze) pending.push(fn); else fn(time); });
    window.__unfreeze = () => { window.__freeze = false; pending.splice(0).forEach(fn => raf(fn)); };
  });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'game2d-test' } })).ok());
  await page.goto(base + '/2d?floor=f2');
  await page.waitForFunction(() => window.__game2d?.ctx.player.enabled && !window.__game2d.core.trip);
  await page.waitForSelector('#loading', { state: 'hidden' });
  check('bootstrap', 'Authenticated playable 2D office is ready.');
  async function capture(name) {
    await page.waitForTimeout(250);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => { window.__freeze = true; resolve(); })));
    await page.screenshot({ path: path.join(output, name), timeout: 90000, animations: 'disabled' });
    await page.evaluate(() => window.__unfreeze());
  }
  const worker = office.floors().find(f => f.id === 'f2').workers.spawn(DESKS[0].id, 'view toggle fixture', undefined, false, 'shell');
  assert.equal(typeof worker, 'object');
  await page.waitForFunction(id => window.__game2d.store.workers.has(id), worker.id);
  await page.evaluate(() => { window.__liveIdentity = { ctx: window.__game2d.ctx, socket: window.__game2d.ctx.net.ws, me: window.__game2d.store.me, floor: window.__game2d.store.floor, pos: window.__game2d.ctx.player.pos.clone() }; });
  await page.keyboard.press('y');
  await page.waitForFunction(() => location.pathname === '/' && window.__game2d.camera.perspective && !document.body.classList.contains('topdown'));
  assert.equal(await page.evaluate(() => { const g = window.__game2d, s = window.__liveIdentity; return g.ctx === s.ctx && g.ctx.net.ws === s.socket && s.socket.readyState === WebSocket.OPEN && g.store.me === s.me && g.store.floor === s.floor && g.ctx.player.pos.distanceTo(s.pos) < 0.05; }), true);
  await capture('live-3d.png');
  await page.keyboard.press('y');
  await page.waitForFunction(() => location.pathname === '/2d' && !window.__game2d.camera.perspective);
  await capture('live-2d.png');
  await page.keyboard.press('Tab');
  await page.keyboard.press('y');
  assert.equal(new URL(page.url()).pathname, '/2d');
  await page.keyboard.press('Escape');
  await page.keyboard.press('y');
  await page.waitForFunction(() => location.pathname === '/' && window.__game2d.camera.perspective);
  assert.equal(await page.evaluate(() => window.__game2d.ctx === window.__liveIdentity.ctx), true);
  assert.equal(await page.evaluate(id => window.__game2d.store.workers.has(id), worker.id), true);
  await page.keyboard.down('y');
  await page.waitForFunction(() => location.pathname === '/2d');
  await page.keyboard.down('y');
  assert.equal(new URL(page.url()).pathname, '/2d');
  await page.keyboard.up('y');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'typing-fixture'; document.body.append(input); input.focus(); });
  await page.keyboard.press('y');
  assert.equal(new URL(page.url()).pathname, '/2d');
  assert.equal(await page.locator('#typing-fixture').inputValue(), 'y');
  await page.evaluate(() => document.getElementById('typing-fixture').remove());
  await page.goto(base + '/?3d=1&floor=f2');
  await page.waitForFunction(() => window.__game2d?.ctx.player.enabled && !window.__game2d.core.trip && window.__game2d.camera.perspective);
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.keyboard.press('y');
  await page.waitForFunction(() => location.pathname === '/2d' && !window.__game2d.camera.perspective);
  assert.deepEqual(errors, []);
  check('live toggle', 'Y switches both ways without rebuilding context, moving the player or changing floor/session; dialogs suppress it.');
} finally { await browser?.close(); office.shutdown(); }
process.exit(0);
