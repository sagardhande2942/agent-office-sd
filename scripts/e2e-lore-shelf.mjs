import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const chromePath = process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('docs/lore-shelf-evidence');
mkdirSync(outputDir, { recursive: true });

const dir = mkdtempSync(path.join(os.tmpdir(), 'office-lore-e2e-'));
const local = path.join(dir, 'project');
mkdirSync(local);
execFileSync('git', ['init', '-b', 'main'], { cwd: local, stdio: 'ignore' });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: local, stdio: 'ignore' });

const data = path.join(dir, '.agent-office');
mkdirSync(data);
writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'local', name: 'Office', dir: local, palette: 0, addedBy: 'test', addedAt: Date.now() }]));

// Seed an initial lore note
const loreDir = path.join(local, '.agent-office', 'lore');
mkdirSync(loreDir, { recursive: true });
writeFileSync(path.join(loreDir, 'seed-1.json'), JSON.stringify({
  id: 'seed-1',
  title: 'Database connection pool gotcha',
  content: 'Set max_connections=20 in test environment to avoid deadlocks.',
  author: 'Architect Agent',
  createdAt: Date.now() - 3600000,
  tags: ['database', 'gotcha'],
}));

const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'lore-test-pw', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;

let browser;
try {
  console.log('Launching browser at:', chromePath);
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 0.5 });
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Lore Tester', color: '#06d6a0', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.lite-declined', '1');
  });

  const loginRes = await context.request.post(base + '/api/login', { data: { password: 'lore-test-pw' } });
  assert.ok(loginRes.ok(), 'login failed');
  console.log('Signed in successfully');

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  console.log('Navigating to', base + '/2d?floor=local');
  await page.goto(base + '/2d?floor=local');

  console.log('Waiting for game2d ready...');
  await page.waitForFunction(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'local' && !window.__game2d.core.trip);
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 30000 });
  console.log('Office loaded');

  // Open menu via Tab key
  await page.keyboard.press('Tab');
  console.log('Pressed Tab to open menu');

  // Click lore menu option
  const loreAction = page.locator('button:has-text("Lore & shift notes"), [data-hud="lore"]');
  await loreAction.waitFor({ state: 'visible' });
  await loreAction.click();
  console.log('Clicked lore action');

  // Verify lore shelf modal appears
  const modal = page.locator('.modal.lore-shelf');
  await modal.waitFor({ state: 'visible' });
  console.log('Lore Shelf modal opened');

  // Verify seed note is displayed
  await page.locator('h3.lore-card-title:has-text("Database connection pool gotcha")').waitFor({ state: 'visible' });
  console.log('Seed note verified');

  // Open editor to add a new note
  const addBtn = modal.locator('button:has-text("Add note")');
  await addBtn.click();

  const editor = page.locator('.modal.lore-editor');
  await editor.waitFor({ state: 'visible' });

  // Fill in note form
  await editor.locator('input[placeholder*="Flaky test"]').fill('Always run build before integration tests');
  await editor.locator('input[placeholder*="Comma-separated"]').fill('build, ci, tips');
  await editor.locator('textarea').fill('The dist/public bundle must be created first before server tests run.');

  // Submit note
  await editor.locator('button[type="submit"]').click();
  await editor.waitFor({ state: 'detached' });

  // Verify newly created note shows up in list
  await page.locator('h3.lore-card-title:has-text("Always run build before integration tests")').waitFor({ state: 'visible' });

  // Screenshot the lore shelf with both notes displayed
  const screenshotPath = path.join(outputDir, 'lore-shelf.png');
  await page.screenshot({ path: screenshotPath });
  console.log('Saved headless verification screenshot to:', screenshotPath);

  // Close modal via close button
  const closeBtn = modal.locator('button.close');
  await closeBtn.click();
  await modal.waitFor({ state: 'detached' });

  console.log('E2E Lore Shelf verification passed successfully!');
} catch (err) {
  console.error('E2E test error:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  office?.server?.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
