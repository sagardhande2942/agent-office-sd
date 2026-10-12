// Boss console loading and recovery during the host handshake.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = path.resolve(process.env.BOSS_CONNECTION_ARTIFACTS ?? '/tmp/agent-office-boss-connection');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-boss-connection-'));
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
// Keep the fixture independent of installed agent CLIs and account usage readers.
const previousPath = process.env.PATH;
if (process.platform === 'win32') {
  const npmShims = path.join(process.env.APPDATA ?? '', 'npm').toLowerCase();
  process.env.PATH = previousPath.split(path.delimiter).filter(entry => path.resolve(entry).toLowerCase() !== npmShims).join(path.delimiter);
}
const config = loadConfig([dir, '--password', 'avatar-test', '--no-open', '--agent', process.execPath]);
config.port = 0;
const office = await startServer(config, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await context.addInitScript(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Connection tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } })));
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'avatar-test' } })).ok());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?3d=1');
  await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });
  // Keep SwiftShader from starving DOM composition during modal screenshots.
  await page.evaluate(() => { window.__office.renderer.render = () => {}; });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /Boss Office/ }).click();
  await page.getByRole('dialog', { name: 'Boss Office', exact: true }).waitFor();
  const setConnection = connection => page.evaluate(connection => {
    const o = window.__office;
    o.store.apply({ t: 'boss.state', floor: o.store.floor, state: { ...o.store.bossMode, connection } });
  }, connection);
  await setConnection('connecting');
  await page.getByLabel('Steer the boss').fill('Add a new car');
  assert.equal(await page.getByRole('switch', { name: 'Boss mode ON/OFF' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Send instruction', exact: true }).isDisabled(), true);
  assert.match(await page.locator('.boss-connection').innerText(), /Connecting to floor host/);
  assert.equal(await page.getByText('Update the floor host to support Boss mode', { exact: true }).count(), 0);
  await page.getByRole('dialog', { name: 'Boss Office', exact: true }).waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, 'boss-connecting.png'), animations: 'disabled' });
  await setConnection('ready');
  assert.equal(await page.getByRole('switch', { name: 'Boss mode ON/OFF' }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Send instruction', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('.boss-connection').isHidden(), true);
  assert.equal(await page.getByLabel('Steer the boss').inputValue(), 'Add a new car');
  await setConnection('unsupported');
  assert.match(await page.locator('.boss-connection').innerText(), /connected floor host does not support/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, 'boss-unsupported.png'), animations: 'disabled' });
  await setConnection('ready');
  await page.getByRole('button', { name: 'Close Boss Office', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Boss Office', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: connecting state disables writes, recovers automatically, preserves drafts and distinguishes unsupported hosts.');
} finally {
  await browser?.close();
  office.shutdown();
  process.env.PATH = previousPath;
}
