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
  async function open() {
    await page.keyboard.press('Tab');
    await page.getByRole('menuitem', { name: /2D graphics settings/ }).click();
  }
  await open();
  assert.equal(await page.getByRole('radio', { name: 'Reduced (current)', exact: true }).getAttribute('aria-checked'), 'true');
  await capture('reduced.png');
  await page.getByRole('radio', { name: 'Enhanced', exact: true }).click();
  await page.waitForFunction(() => window.__game2d.ctx.renderer.shadowMap.enabled && window.__game2d.ctx.renderer.getPixelRatio() >= 2);
  check('enhanced', 'Quality changes immediately to supersampling and real-time shadows.');
  await capture('enhanced.png');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game2d.ctx.player.enabled);
  await page.reload();
  await page.waitForFunction(() => window.__game2d?.ctx.player.enabled && window.__game2d.ctx.canvas.dataset.graphics === 'enhanced');
  await page.waitForSelector('#loading', { state: 'hidden' });
  assert.ok(await page.evaluate(() => window.__game2d.ctx.renderer.shadowMap.enabled));
  check('persistence', 'Enhanced survives a reload in the same browser.');
  // Activities retain their original rendering, then return to the chosen quality.
  await page.evaluate(() => { const g = window.__game2d; g.testOff = g.ctx.activities.add({ id: 'graphics-camera-test', active: () => true, stop: () => {}, takesCamera: true }); });
  await page.waitForFunction(() => window.__game2d.camera.perspective && window.__game2d.ctx.renderer.getPixelRatio() === Math.min(devicePixelRatio, 2));
  await page.evaluate(() => window.__game2d.testOff());
  await page.waitForFunction(() => !window.__game2d.camera.perspective && window.__game2d.ctx.renderer.getPixelRatio() >= 2);
  check('activity quality', 'Activity camera restores original resolution and returning restores enhanced quality.');
  await open();
  await page.getByRole('radio', { name: 'Reduced (current)', exact: true }).click();
  await page.waitForFunction(() => !window.__game2d.ctx.renderer.shadowMap.enabled && window.__game2d.ctx.renderer.getPixelRatio() === Math.min(devicePixelRatio, 2));
  await page.locator('.backdrop').last().locator('button.close').click();
  await page.waitForFunction(() => window.__game2d.ctx.player.enabled);
  await capture('office-reduced.png');
  check('reduced and close', 'Restores original quality; Esc and top-right close resume controls.');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots: ['reduced.png', 'enhanced.png', 'office-reduced.png'] }, null, 2));
} catch (error) { console.error(error); throw error; }
finally { await browser?.close(); office.shutdown(); }
console.log(`Evidence: ${output}`);
process.exit(0);
