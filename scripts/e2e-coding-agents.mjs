import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = path.resolve('docs');
fs.mkdirSync(output, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-ca-'));
const checkout = path.join(dir, 'f1');
fs.mkdirSync(checkout);
execFileSync('git', ['init', '-b', 'main'], { cwd: checkout, stdio: 'ignore' });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: checkout, stdio: 'ignore' });

const floors = [{ id: 'f1', name: 'Main floor', dir: checkout, palette: 0, addedBy: 'test', addedAt: 1 }];
const data = path.join(dir, '.agent-office');
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'floors.json'), JSON.stringify(floors));

const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'ca-test', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;

console.log('Server running at', base);

let browser;
try {
  let executable = process.env.CHROMIUM_PATH;
  if (!executable) {
    const candidates = [
      path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(os.homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
    ];
    executable = candidates.find((c) => fs.existsSync(c));
  }
  assert.ok(executable, 'Chromium executable must exist');

  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'CA Tester', color: '#4080ff', look: { skin: 0, hair: 0, style: 0 } }));
  });

  const login = await context.request.post(`${base}/api/login`, { data: { password: 'ca-test' } });
  assert.ok(login.ok(), 'Login must succeed');

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(`${base}/2d?floor=f1`);
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { polling: 100 });
  await wait(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'f1' && !window.__game2d.core.trip && window.__game2d.ctx.player.enabled);
  await wait(() => !document.getElementById('loading') || document.getElementById('loading').classList.contains('gone'));

  console.log('Office loaded');

  // Open via Tab Menu -> Coding Agents
  await page.keyboard.press('Tab');
  await page.getByRole('menuitem', { name: /Coding Agents/ }).click({ force: true });
  await page.locator('.modal.coding-agents').waitFor();
  console.log('Opened Coding Agents modal');

  // Verify providers are listed
  const navItems = page.locator('.ca-nav-item');
  const count = await navItems.count();
  assert.equal(count, 10, 'Expected 10 coding agent providers in sidebar');

  // Select OpenCode
  await page.locator('.ca-nav-item', { hasText: 'OpenCode' }).click();
  await page.getByRole('heading', { name: 'OpenCode', exact: true }).waitFor();

  // Switch to Auto-approve mode
  await page.locator('button', { hasText: /Auto-approve/ }).click();

  // Save changes
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Wait for state to sync
  await wait(() => window.__game2d.store.codingAgents?.config?.opencode?.permissionMode === 'auto-approve');
  console.log('Saved OpenCode auto-approve mode');

  // Screenshot modal for evidence
  await page.locator('.modal.coding-agents').screenshot({ path: path.join(output, 'coding-agents-modal.png') });
  console.log('Captured screenshot at docs/coding-agents-modal.png');

  // Close with ✕
  await page.locator('.modal.coding-agents button.close').click();
  await wait(() => !document.querySelector('.backdrop') && window.__game2d.ctx.player.enabled);
  console.log('Closed modal with close button; player re-enabled');

  // Open via Settings -> Workers -> Configure coding agents
  await page.keyboard.press('Tab');
  await page.getByRole('menuitem', { name: /Settings/ }).click({ force: true });
  await page.getByRole('tab', { name: /Workers/ }).click({ force: true });
  await page.getByRole('button', { name: /Configure coding agents/ }).click({ force: true });
  await page.locator('.modal.coding-agents').waitFor();
  console.log('Opened Coding Agents via Settings extension');

  // Close Coding Agents with Escape
  await page.keyboard.press('Escape');
  await wait(() => !document.querySelector('.modal.coding-agents'));
  console.log('Closed Coding Agents modal with Escape');

  // Close Settings with Escape
  await page.keyboard.press('Escape');
  await wait(() => !document.querySelector('.backdrop') && window.__game2d.ctx.player.enabled);
  console.log('Closed Settings with Escape; player re-enabled');

  // Check saved state in .agent-office
  const savedState = JSON.parse(fs.readFileSync(path.join(data, 'coding-agents.json'), 'utf8'));
  assert.equal(savedState.config.opencode.permissionMode, 'auto-approve');
  console.log('Verified persistence in .agent-office/coding-agents.json');

  console.log('ALL CHECKS PASSED');
} catch (err) {
  console.error('TEST ERROR:', err);
  throw err;
} finally {
  if (browser) await browser.close();
  office.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
}
