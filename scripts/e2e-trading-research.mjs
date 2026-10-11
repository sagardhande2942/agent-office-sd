// npm run build && node --import tsx scripts/e2e-trading-research.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { ResearchStore } from '../src/server/trading-research/coordinator/store.ts';
import { DiscoveryAdapter } from '../src/server/trading-research/coordinator/adapter.ts';
import { ResearchScheduler } from '../src/server/trading-research/coordinator/scheduler.ts';
import { researchServer } from '../src/server/trading-research/coordinator/server.ts';

const output = path.resolve(process.env.RESEARCH_ARTIFACTS ?? '/tmp/agent-office-trading-research-evidence'); mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-research-browser-')), project = path.join(dir, 'project'), tradeai = path.join(dir, 'tradeai');
mkdirSync(project); mkdirSync(path.join(tradeai, 'discovery'), { recursive: true });
writeFileSync(path.join(tradeai, 'discovery/__init__.py'), ''); writeFileSync(path.join(tradeai, 'root_ai.py'), '');
writeFileSync(path.join(tradeai, 'discovery/strategy_validator.py'), 'import ast\nfrom types import SimpleNamespace\ndef validate_strategy_code(code):\n ast.parse(code)\n return SimpleNamespace(is_valid=True,errors=[])\n');
writeFileSync(path.join(tradeai, 'discovery/evaluate_strategy.py'), `import json,sys\nphase=sys.argv[sys.argv.index('--phase')+1]\nname=sys.argv[sys.argv.index('--strategy-name')+1]\nprint('===DISCOVERY_RESULT_JSON===')\nprint(json.dumps({'phase':phase,'strategy_name':name,'engine_version':'browser-fixture','valid':True,'total_trades':18,'total_pnl':-12.5,'max_drawdown':2.1,'costs_explicit':True}))\nprint('===END_DISCOVERY_RESULT_JSON===')\n`);
const agent = path.join(dir, 'claude');
writeFileSync(agent, `#!${process.execPath}\nif(process.argv.includes('-p')||process.argv.includes('--print')) { console.log(JSON.stringify({name:'Research task',summary:'Research campaign'})); process.exit(0); }\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
const store = new ResearchStore(path.join(dir, 'coordinator')), token = 'c'.repeat(64);
const server = researchServer(store, token); await new Promise(r => server.listen(0, '127.0.0.1', r));
const coordinatorUrl = `http://127.0.0.1:${server.address().port}`;
const adapter = new DiscoveryAdapter({ tradeai, python: process.env.RESEARCH_TEST_PYTHON ?? 'python3', script: path.resolve('bin/research-evaluate.py') }, store);
const scheduler = new ResearchScheduler(store, adapter); scheduler.start();
const cfg = loadConfig([project, '--password', 'research-browser', '--no-open', '--agent', agent]); cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') }), base = `http://127.0.0.1:${office.server.address().port}`;
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');
const errors = [], checks = []; let browser, page;
const check = name => { checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Research tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(ts => { const r = window.__office?.renderer; if (r) r.render = () => {}; cb(ts); });
  });
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'research-browser' } })).ok());
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?3d=1'); await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });
  const open = async target => { await target.keyboard.press('Tab'); await target.getByRole('menuitem', { name: /Trading Research/ }).click(); await target.getByRole('dialog', { name: 'Trading Research', exact: true }).waitFor(); };
  await open(page);
  await page.getByText('Enable this module to connect a research coordinator.').waitFor();
  await page.getByLabel('Enable Trading Research').check(); await page.getByLabel('Coordinator URL').fill(coordinatorUrl); await page.getByLabel('Coordinator token').fill(token);
  await page.getByRole('button', { name: 'Save connection', exact: true }).click(); await page.getByText('Connected · worker generation · paid AI disabled').waitFor();
  assert.equal(await page.getByLabel('Coordinator token').inputValue(), ''); check('Floor connection works; token is cleared from the form');
  await page.getByLabel('Research objective', { exact: true }).fill('Investigate whether session filtering reduces excessive trading');
  await page.getByLabel('Research constraints').fill('Use development data only; include costs and avoid repeated parameter searches.');
  await page.getByLabel('Development start').fill('2023-01-01'); await page.getByLabel('Development end').fill('2024-01-01'); await page.getByLabel('Dataset version').fill('Synthetic browser fixture v1');
  await page.getByLabel('Run walk-forward').check();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click(); await page.locator('.research-assignment').first().waitFor();
  await page.locator('.research-scroll').evaluate(el => el.scrollTop = 0); await page.screenshot({ path: path.join(output, 'setup-desktop.png') });
  const floor = office.floors()[0];
  const researcher = floor.workers.spawn('desk-1', 'fixture', undefined, false, 'agent', 'claude'); assert.notEqual(typeof researcher, 'string'); researcher.status = 'idle';
  // Refresh the UI fixture's roster after its noninteractive namer completes.
  await page.waitForFunction(id => window.__office.store.workers.has(id), researcher.id);
  await page.evaluate(id => { window.__office.store.workers.get(id).status = 'idle'; }, researcher.id);
  // A campaign state change refreshes eligible workers in the assignment controls.
  await page.getByRole('button', { name: 'Pause scheduling', exact: true }).click(); await page.getByRole('button', { name: 'Resume campaign', exact: true }).click();
  const firstAssignment = page.locator('.research-assignment').first(); await firstAssignment.locator('select').selectOption(researcher.id);
  assert.equal(await firstAssignment.locator('select').inputValue(), researcher.id);
  await firstAssignment.getByRole('button', { name: 'Assign worker', exact: true }).click(); await page.getByText('researcher · assigned', { exact: true }).waitFor();
  const workerToken = id => JSON.parse(readFileSync(path.join(project, '.agent-office/workers.json'), 'utf8')).find(w => w.id === id).hookToken;
  const call = async (id, body) => {
    const response = await fetch(`http://127.0.0.1:${office.hookPort}/office/workers/research?worker=${id}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${workerToken(id)}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  const packet = await call(researcher.id);
  await call(researcher.id, { assignment: packet.assignment.id, lease: packet.assignment.lease, hypothesis: 'A session filter reduces overtrading',
    code: 'class Strategy:\n def __init__(self,*args): pass\n def trade(self,trade_dict=None): return trade_dict\n', config: '{"config":{},"alphas":{},"exit_alphas":{},"RMS":{}}' });
  await page.getByText('reviewer · queued', { exact: true }).waitFor(); await page.getByText(/net PnL -12.5/).first().waitFor();
  assert.equal(await page.getByText(/net PnL -12.5/).count(), 2);
  check('Worker submission launches the real adapter against a deterministic evaluator fixture and queues review');
  const second = await context.newPage(); await second.goto(base + '/?3d=1'); await second.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled); await second.waitForSelector('#loading', { state: 'hidden' }); await open(second);
  await second.getByText(/net PnL -12.5/).first().waitFor(); check('A second connected browser sees the same measured experiment');
  await second.close();
  await page.getByRole('button', { name: 'View evidence', exact: true }).click(); await page.getByRole('dialog').last().getByText(/browser-fixture/).waitFor(); await page.keyboard.press('Escape');
  await page.locator('.research-scroll').evaluate(el => el.scrollTop = el.scrollHeight); await page.screenshot({ path: path.join(output, 'experiments-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.research-scroll').evaluate(el => el.scrollTop = el.scrollHeight); await page.screenshot({ path: path.join(output, 'experiments-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); check('Mobile layout stays within the viewport');
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene' && window.__office.player.enabled && window.__office.player.hasMouse);
  await open(page); await page.getByRole('dialog', { name: 'Trading Research', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene' && window.__office.player.enabled && window.__office.player.hasMouse);
  check('Esc and top-right close restore mouse-look without another click'); assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ fixture: 'Synthetic evaluator results; real Office, coordinator, worker hooks and Python adapter', checks, browserErrors: errors }, null, 2));
} catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
finally {
  await browser?.close(); await scheduler.stop();
  for (const floor of office.floors()) for (const worker of floor.workers.list()) await floor.workers.kill(worker.id, 'keep');
  office.shutdown(); await new Promise(r => server.close(r)); await new Promise(r => setTimeout(r, 250)); rmSync(dir, { recursive: true, force: true });
}
console.log(`Evidence: ${output}`);
process.exit(0);
