// node --import tsx scripts/... run from the worktree root; screenshots go to /tmp/opencode/wt-shots
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = process.env.OUT ?? '/tmp/agent-office-worker-roles-evidence';
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-wt-default-'));
const local = path.join(dir, 'project');
mkdirSync(local);
execFileSync('git', ['init', '-b', 'main'], { cwd: local, stdio: 'ignore' });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: local, stdio: 'ignore' });
const data = path.join(dir, '.agent-office');
mkdirSync(data);
const cli = path.join(dir, 'agent');
writeFileSync(cli, `#!/bin/sh\nsleep 600\n`);
chmodSync(cli, 0o755);
writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'local', name: 'Office', dir: local, palette: 0, addedBy: 'test', addedAt: Date.now() }]));
const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'wt-test', '--no-open']);
cfg.port = 0;
cfg.agentCmd = cli;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Pixel', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
  });
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'wt-test' } })).ok());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });

  const openHire = async () => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Find anything in the office' }).fill('Hire a worker');
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).waitFor();
  };
  await openHire();
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Inspect login security');
  await page.getByLabel('Worker role', { exact: true }).selectOption('reviewer');
  assert.match(await prompt.inputValue(), /^\[Office worker role: reviewer\]\nInspect login security/);
  await page.screenshot({ path: path.join(output, 'worker-role-reviewer.png') });
  await page.getByLabel('Worker role', { exact: true }).selectOption('tester');
  assert.match(await prompt.inputValue(), /^\[Office worker role: tester\]/);
  assert.equal((await prompt.inputValue()).split('[Office worker role:').length, 2);
  const box = page.locator('#wt-toggle');
  assert.equal(await box.isChecked(), true, 'a brand new hire opens with its own worktree ticked');
  await page.screenshot({ path: path.join(output, '1-hire-worktree-ticked.png') });

  // Unticking sticks for the next hire (the choice is kept once a hire is sent).
  await box.uncheck();
  await prompt.fill('[Office worker role: tester]\nCheck the worktree default');
  await page.getByRole('button', { name: /Hire|Send/ }).click();
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).waitFor({ state: 'detached' });
  const assignments = JSON.parse(readFileSync(path.join(local, '.agent-office/worker-roles.json'), 'utf8'));
  assert.ok(Object.values(assignments).includes('tester'), 'real hiring persists the selected role');
  await openHire();
  assert.equal(await page.locator('#wt-toggle').isChecked(), false, 'an unticked box is remembered');
  await page.screenshot({ path: path.join(output, '2-hire-worktree-remembered-unticked.png') });
  await page.locator('#wt-toggle').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();


  assert.deepEqual(errors, []);
  console.log('PASS: role selection, reassignment, hiring, screenshot and dialog close');
} finally {
  await browser?.close();
  office.shutdown();
}