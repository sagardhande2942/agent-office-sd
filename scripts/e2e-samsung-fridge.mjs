// npm run build && node --import tsx scripts/e2e-samsung-fridge.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = path.resolve(process.env.FRIDGE_ARTIFACTS ?? '/tmp/agent-office-fridge-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-fridge-'));
const checkout = path.join(dir, 'project'); mkdirSync(checkout);
execFileSync('git', ['init', '-b', 'main'], { cwd: checkout, stdio: 'ignore' });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: checkout, stdio: 'ignore' });
const data = path.join(dir, '.agent-office'); mkdirSync(data);
writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'local', name: 'Office', dir: checkout, palette: 0, addedBy: 'test', addedAt: Date.now() }]));
const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'fridge-test', '--no-open']);
cfg.port = 0; cfg.agentCmd = 'fridge-test-agent-unavailable';
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let browser, page;
const errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Fridge tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.lite-declined', '1');
  });
  page = await context.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', error => errors.push(error.message));
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'fridge-test' } })).ok());
  await page.goto(base + '/'); console.log('Page loaded');
  await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' }); console.log('Office ready');
  await page.evaluate(() => {
    const { player, office } = window.__office;
    if (office.fridge.group.name !== 'samsung_fridge') throw Error('Samsung fixture was not installed');
    player.setView('first'); player.pos.set(-11.3, 0, 8.9); player.camYaw = Math.PI; player.lookPitch = -0.12;
  });
  await page.waitForFunction(() => window.__office.camera.position.z > 8.8);
  await page.screenshot({ path: path.join(output, 'closed.png') });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__office.office.fridge.open);
  await page.waitForFunction(() => Math.abs(window.__office.office.fridge.group.getObjectByName('fridge_left_hinge').rotation.y + 2.02) < .001);
  await page.screenshot({ path: path.join(output, 'open.png') });
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__office.office.fridge.cans === 4);
  assert.equal(await page.evaluate(() => window.__office.office.fridge.group.getObjectByName('fridge_can_0').visible), false);
  await page.screenshot({ path: path.join(output, 'drink-taken.png') });
  await page.keyboard.press('e');
  await page.waitForFunction(() => !window.__office.office.fridge.open);
  await page.waitForFunction(() => window.__office.office.fridge.group.getObjectByName('fridge_left_hinge').rotation.y === 0);
  await page.keyboard.press('c');
  assert.equal(await page.evaluate(() => window.__office.office.fridge.cans), 4);
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks: ['Samsung fixture installed in real office', 'E opens both hinged doors', 'C removes visible drink and decrements stock', 'E closes doors', 'Closed fridge does not dispense'], errors }, null, 2));
  console.log('Fridge browser checks passed:', output);
} catch (error) {
  console.error(errors); console.error(await page?.locator('body').innerText().catch(() => ''));
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  office.shutdown();
}
process.exit(0);
