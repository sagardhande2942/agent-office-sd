import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-spend-e2e-'));
const project = path.join(home, 'project'); fs.mkdirSync(project);
execFileSync('git', ['init', '-b', 'main'], { cwd: project });
fs.mkdirSync(path.join(home, '.agent-office'));
fs.writeFileSync(path.join(home, '.agent-office/floors.json'), JSON.stringify([{ id: 'local', name: 'Spend fixture', dir: project, palette: 0, addedBy: 'test', addedAt: Date.now() }]));
const cfg = loadConfig(['--home', home, '--port', '4600', '--password', 'spend-fixture', '--no-open']); cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.addInitScript(() => { localStorage.setItem('agent-office.settings', JSON.stringify({ hud: { spend: true } })); localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Spend tester', color: '#06d6a0', look: { skin: 0, hair: 0, style: 0 } })); localStorage.setItem('agent-office.lite-declined', '1'); });
  await context.request.post(base + '/api/login', { data: { password: 'spend-fixture' } });
  const page = await context.newPage(); await page.goto(base + '/2d?floor=local');
  await page.waitForFunction(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'local');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0 };
    const count = (tokens, cost, unknownCost, partial = false) => ({ tokens, cost, unknownCost, partial });
    window.__game2d.store.apply({ t: 'usage', state: { total: zero, today: zero, day: '2026-10-13', budget: 10, budgetCost: 12, pauseHiring: true, reported: [
      { provider: 'codex', today: count(120000, 0, true, true), total: count(250000, 0, true, true) },
      { provider: 'opencode', today: count(80000, 12, false), total: count(180000, 30, false) },
      { provider: 'dsh', today: count(0, 0, true, true), total: count(0, 0, true, true) },
    ] } });
  });
  await page.locator('#usage').getByText(/Codex root sessions today/).waitFor();
  assert.match(await page.locator('#usage').innerText(), /Budget known spend \$12.00/);
  assert.match(await page.locator('#usage').innerText(), /cost unavailable/);
  const output = path.resolve(process.env.SPEND_ARTIFACTS ?? 'docs/provider-spend-evidence'); fs.mkdirSync(output, { recursive: true });
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: path.join(output, `spend-${width}.png`) }); }
  console.log('PASS provider spend UI');
} finally { await browser?.close(); office.shutdown(); fs.rmSync(home, { recursive: true, force: true }); }
