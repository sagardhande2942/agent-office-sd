// npm run build && node --import tsx scripts/e2e-floor-remove.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = path.resolve(process.env.FLOOR_REMOVE_ARTIFACTS ?? 'docs/floor-remove-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-floor-remove-'));
const local = path.join(dir, 'project'); mkdirSync(local);
execFileSync('git', ['init', '-b', 'main'], { cwd: local, stdio: 'ignore' });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: local, stdio: 'ignore' });
const data = path.join(dir, '.agent-office'); mkdirSync(data);
const common = { palette: 0, addedBy: 'test', addedAt: Date.now() };
writeFileSync(path.join(data, 'floors.json'), JSON.stringify([
  { ...common, id: 'local', name: 'Office', dir: local },
  { ...common, id: 'remote', name: 'Mock server', dir: '/joiner/mock_server', repo: 'tradai/mock_server', host: 'laptop' },
]));
writeFileSync(path.join(data, 'hosts.json'), JSON.stringify({ hosts: [{ id: 'laptop', name: 'Offline laptop', hash: '00', createdAt: Date.now(), createdBy: 'test', seats: 4, accepting: true }], codes: [] }));
const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'floor-remove-test', '--no-open']);
cfg.port = 0; cfg.agentCmd = 'floor-remove-test-agent-unavailable';
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Admin tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.lite-declined', '1');
  });
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'floor-remove-test' } })).ok());
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/');
  await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.keyboard.press('Tab');
  await page.getByRole('menuitem', { name: /Elevator|Floors/ }).click();
  await page.getByRole('button', { name: 'Remove Mock server', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'before.png') });
  await page.getByRole('button', { name: 'Remove Mock server', exact: true }).click();
  await page.getByRole('button', { name: '🗑 Remove floor', exact: true }).click();
  await page.waitForFunction(() => !window.__office.store.floors.some(f => f.id === 'remote'));
  assert.equal(await page.getByRole('button', { name: 'Remove Mock server', exact: true }).count(), 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(data, 'floors.json'), 'utf8')).map(f => f.id), ['local']);
  await page.screenshot({ path: path.join(output, 'after.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: offline remote floor removed from Elevator and saved floors without restarting');
} finally {
  await browser?.close(); office.shutdown();
}
process.exit(0);
