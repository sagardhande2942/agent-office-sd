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

const output = path.resolve(process.env.GAME2D_ARTIFACTS ?? '/tmp/agent-office-performance-evidence');
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
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), process.platform === 'darwin' ? 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' : 'chrome-linux64/chrome');
let browser, page;
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
  await page.waitForFunction(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'f2' && !window.__game2d.core.trip);
  await page.waitForSelector('#loading', { state: 'hidden' });
  async function settings() {
    await page.keyboard.press('Tab');
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    await page.getByRole('tab', { name: /You/ }).click();
  }
  await settings();
  const radios = page.getByRole('radiogroup', { name: 'Office FPS', exact: true });
  assert.equal(await radios.getByRole('radio').count(), 5);
  assert.equal(await radios.getByRole('radio', { name: '60 FPS', exact: true }).getAttribute('aria-checked'), 'true');
  for (const label of ['30 FPS', '60 FPS', '90 FPS', '120 FPS', 'Match display']) {
    await radios.getByRole('radio', { name: label, exact: true }).click();
    assert.equal(await radios.getByRole('radio', { name: label, exact: true }).getAttribute('aria-checked'), 'true');
  }
  await radios.getByRole('radio', { name: '30 FPS', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'performance-settings.png') });
  assert.equal(await page.evaluate(() => window.__game2d.ctx.ticks.frameRate()), 15);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene');
  assert.equal(await page.evaluate(() => window.__game2d.ctx.ticks.frameRate()), 30);
  check('FPS choices and modal pacing', 'All five choices apply; ordinary Settings window caps at 15 FPS and close restores selected 30 FPS and canvas focus.');
  await page.reload();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await settings();
  assert.equal(await page.getByRole('radio', { name: '30 FPS', exact: true }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene');
  check('persistence and Escape', '30 FPS survives reload; Escape closes Settings and restores canvas focus.');
  // Simulate the visibility lifecycle deterministically: Chromium headless tab visibility varies by platform.
  await page.evaluate(() => {
    window.__performanceTicks = 0;
    window.__game2d.ctx.ticks.add('hud', () => window.__performanceTicks++);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = await page.evaluate(() => window.__performanceTicks);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__performanceTicks), before);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.__performanceTicks > 0);
  check('visibility lifecycle', 'Simulated hidden state suspends ticks; visibility return resumes them.');
  await page.getByRole('button', { name: 'Switch to 3D', exact: true }).click();
  await page.waitForSelector('#loading', { state: 'hidden' });
  await settings();
  assert.equal(await page.getByRole('radio', { name: '30 FPS', exact: true }).getAttribute('aria-checked'), 'true');
  await page.screenshot({ path: path.join(output, 'performance-settings-3d.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene');
  await page.waitForFunction(() => document.pointerLockElement?.id === 'scene');
  await settings();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.pointerLockElement?.id === 'scene');
  check('shared 3D settings', 'Saved FPS applies in 3D; screenshot captured; both Close and Escape restore mouse-look.');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots: ['performance-settings.png', 'performance-settings-3d.png'] }, null, 2));
} catch (error) {
  console.error('Page errors:', errors);
  if (page && !page.isClosed()) {
    console.error('URL:', page.url());
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); office.shutdown();
}
console.log(`Evidence: ${output}`);
process.exit(0);
