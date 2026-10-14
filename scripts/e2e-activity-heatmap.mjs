// npm run build && node --import tsx scripts/e2e-activity-heatmap.mjs
// Real server and persisted structured fixtures; no mocked browser API responses or model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { aggregateActivity, ACTIVITY_PHASES } from '../src/shared/activity-heatmap.ts';

const output = path.resolve(process.env.HEATMAP_ARTIFACTS ?? '/tmp/agent-office-activity-heatmap-evidence');
mkdirSync(output, { recursive: true });
const home = mkdtempSync(path.join(os.tmpdir(), 'office-heatmap-browser-'));
const recorded = path.join(home, 'recorded'), empty = path.join(home, 'empty');
for (const dir of [recorded, empty]) {
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
}
const now = Date.now(), since = now - 30 * 60000;
const intervals = ACTIVITY_PHASES.map((phase, n) => ({ workerId: 'fixture-alpha', activityId: 'fixture-activity', taskId: 'typed-api', attempt: phase === 'retries' ? 2 : 1, phase, start: since + n * 2 * 60000, end: since + (n * 2 + 2) * 60000 }));
intervals.push({ workerId: 'fixture-beta', activityId: 'other-activity', taskId: 'auth-tests', attempt: 1, phase: 'waiting', start: since + 60000, end: since + 8 * 60000 });
mkdirSync(path.join(recorded, '.agent-office'));
writeFileSync(path.join(recorded, '.agent-office/activity-heatmap.json'), JSON.stringify({ version: 1, now: now - 60000, intervals,
  coverage: { since, lastObservedAt: now - 60000, dropped: 4, historical: true, gaps: [{ start: now - 5 * 60000, end: now - 4 * 60000 }], unavailable: { checks: 'Providers without paired tool boundaries cannot measure check duration.' } } }));
mkdirSync(path.join(home, '.agent-office'));
writeFileSync(path.join(home, '.agent-office/floors.json'), JSON.stringify([
  { id: 'recorded', name: 'Recorded activity', dir: recorded, palette: 0, addedBy: 'test', addedAt: now },
  { id: 'empty', name: 'Empty activity', dir: empty, palette: 1, addedBy: 'test', addedAt: now },
]));
const binary = path.join(home, 'fixture-agent');
writeFileSync(binary, `#!${process.execPath}\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
const cfg = loadConfig(['--home', home, '--password', 'heatmap-browser', '--no-open', '--agent', binary]); cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const cache = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), process.platform === 'win32' ? 'chrome-win64/chrome.exe' : 'chrome-linux64/chrome');
const checks = [], errors = [], screenshots = [];
const check = name => { checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
let browser, page;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Heatmap tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.lite-declined', '1');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(ts => { const r = window.__office?.renderer; if (r) r.render = () => {}; cb(ts); });
  });
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'heatmap-browser' } })).ok());
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  const dialog = () => page.getByRole('dialog', { name: 'Office activity heatmap', exact: true });
  const shot = async name => { await page.screenshot({ path: path.join(output, name) }); screenshots.push(name); };
  const openLite = async floor => { await page.goto(`${base}/lite?floor=${floor}`); await page.locator('#btn-activity-heatmap').click(); await dialog().waitFor(); };
  await openLite('empty');
  await dialog().getByText('No recorded activity intervals yet.', { exact: false }).waitFor();
  assert.equal(await dialog().locator('.heatmap-cell').count(), 0);
  await shot('empty.png'); check('Empty real floor shows missing recorded intervals without invented cells');
  await openLite('recorded');
  await dialog().locator('.heatmap-cell').first().waitFor();
  const api = await context.request.get(base + '/api/activity-heatmap?floor=recorded'); assert.ok(api.ok());
  const snapshot = await api.json(), expected = aggregateActivity(snapshot);
  assert.equal(expected.workerTime, 19 * 60000); assert.equal(expected.wallTime, 12 * 60000);
  assert.match(await dialog().innerText(), /Summed worker-time: 19.0 min/);
  assert.match(await dialog().innerText(), /Observed wall time: 12.0 min/);
  await dialog().getByText('Recording coverage & limitations', { exact: true }).click();
  assert.match(await dialog().innerText(), /Partial historical coverage/);
  assert.match(await dialog().innerText(), /Truncated history: 4/);
  assert.match(await dialog().innerText(), /Unobserved restart gaps/);
  assert.match(await dialog().innerText(), /signal unavailable/);
  assert.equal(await dialog().getByLabel('Phase legend').locator('span').count(), 6);
  const implementation = dialog().getByRole('button', { name: /fixture-alpha,.*Implementation/ }).first();
  await implementation.focus();
  assert.match(await dialog().getByLabel('Time bucket details').innerText(), /Task typed-api · Attempt 1/);
  await dialog().getByText('Recording coverage & limitations', { exact: true }).click();
  await dialog().locator('[data-phase=waiting]').click();
  assert.equal(await dialog().locator('[data-phase=waiting]').getAttribute('aria-pressed'), 'true');
  assert.ok(await dialog().locator('.heatmap-cell[data-muted=true]').count());
  await shot('phase-highlight.png');
  await dialog().locator('[data-phase=waiting]').click();
  assert.equal(await dialog().locator('.heatmap-cell[data-muted=true]').count(), 0);
  const closeBox = await dialog().locator('.close').boundingBox(), dialogBox = await dialog().boundingBox();
  assert.ok(closeBox.x > dialogBox.x + dialogBox.width - 80, 'Close control stays in the top-right corner');
  await shot('recorded-desktop.png'); check('Persisted five phases plus unknown, overlap totals, partial/truncated/gap coverage and accessible details');
  await dialog().getByLabel('Activity', { exact: true }).selectOption('fixture-activity');
  assert.equal(await dialog().locator('tbody tr').count(), 1);
  await dialog().getByLabel('Worker', { exact: true }).selectOption('fixture-beta');
  await dialog().getByText('No recorded intervals match', { exact: false }).waitFor();
  await dialog().getByLabel('Worker', { exact: true }).selectOption('fixture-alpha');
  await dialog().getByLabel('Bucket size', { exact: true }).selectOption('300000');
  const columnCount = await dialog().locator('thead th').count(); assert.ok(columnCount >= 7 && columnCount <= 8);
  await shot('filtered.png'); check('Worker/activity filters and bucket selection use recorded data');
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('Mobile dialog contains horizontal heatmap scrolling');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('Escape');
  // A real idle fake process supplies lifecycle observations without any external AI provider.
  const floor = office.floors().find(f => f.id === 'recorded'); await floor.ready;
  const worker = floor.workers.spawn('desk-1', 'browser-test', 'Observe lifecycle fixture', false, 'agent', 'claude');
  assert.notEqual(typeof worker, 'string', String(worker));
  const token = JSON.parse(readFileSync(path.join(recorded, '.agent-office/workers.json'), 'utf8')).find(w => w.id === worker.id).hookToken;
  const hook = await fetch(`http://127.0.0.1:${office.hookPort}/hooks/claude?worker=${worker.id}&event=UserPromptSubmit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  assert.ok(hook.ok);
  await openLite('recorded');
  await dialog().locator('.heatmap-cell[data-live]').first().waitFor();
  await dialog().getByLabel('Worker', { exact: true }).selectOption(worker.id);
  await dialog().locator('.heatmap-cell[data-live]').first().focus();
  await page.waitForFunction(() => document.querySelector('.heatmap-details')?.textContent.includes('Live interval'));
  const before = await dialog().getByLabel('Time bucket details').innerText();
  await page.waitForFunction(before => document.querySelector('.heatmap-details')?.textContent !== before, before);
  assert.equal(await dialog().getByLabel('Worker', { exact: true }).inputValue(), worker.id);
  assert.ok(await dialog().locator('.heatmap-cell:focus').count());
  await shot('live.png'); check('Real worker lifecycle produces live intervals; polling preserves filters and focused cell');
  for (const [view, route] of [['3d', '/?3d=1&floor=recorded'], ['2d', '/2d?floor=recorded']]) {
    await page.goto(base + route);
    await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
    await page.waitForSelector('#loading', { state: 'hidden' });
    const open = async () => { await page.keyboard.press('Tab'); await page.getByRole('menuitem', { name: /Activity heatmap/ }).click(); await dialog().locator('.heatmap-cell').first().waitFor(); };
    await open(); await shot(view + '.png'); await page.keyboard.press('Escape');
    const restored = view => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene' && window.__office.player.enabled && (view === '2d' ? !window.__office.player.mouseLook : window.__office.player.hasMouse);
    await page.waitForFunction(restored, view);
    await open(); await dialog().getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForFunction(restored, view);
    check(view + ' entry and Esc/X restore scene focus and mouse-look');
  }
  assert.deepEqual(errors, []); check('No browser runtime errors');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, failure: String(error) }, null, 2)); throw error;
} finally {
  await browser?.close(); office.shutdown(); await new Promise(resolve => setTimeout(resolve, 250)); rmSync(home, { recursive: true, force: true });
}
console.log(`Evidence: ${output}`);
process.exit(0);
