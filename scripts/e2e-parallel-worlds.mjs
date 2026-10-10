// Production-bundle browser verification with three real worktrees and deterministic fake agents.
// npm run build && node --import tsx scripts/e2e-parallel-worlds.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = process.env.WORLDS_ARTIFACTS ?? '/tmp/agent-office-worlds-evidence'; mkdirSync(output, { recursive: true });
const home = mkdtempSync(path.join(os.tmpdir(), 'worlds-e2e-'));
const checkout = path.join(home, 'project'); mkdirSync(checkout);
const git = args => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '-b', 'main']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'baseline']);
const baseCommit = git(['rev-parse', 'HEAD']);
const fake = path.join(home, 'fake-agent');
const previewCode = `const http=require('node:http'),fs=require('node:fs'); const id=process.env.AGENT_OFFICE_WORKER_ID; const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Universe '+id+'</title><body style="background:#121a30;color:#dff;font:24px system-ui;padding:35px"><h1>Universe '+id+'</h1><p>Isolated working preview</p><button onclick="this.textContent=\\\'Interaction verified\\\'">Try this version</button></body>');});server.listen(0,'127.0.0.1',()=>fs.writeFileSync('.preview-port',String(server.address().port)));`;
writeFileSync(fake, `#!${process.execPath}\nconst {spawn}=require('node:child_process');\nconst child=spawn(process.execPath,['-e',${JSON.stringify(previewCode)}],{stdio:'inherit'});\nprocess.on('SIGTERM',()=>{child.kill();process.exit(0);});\nprocess.stdin.on('data',()=>console.log('Feedback received'));\nconsole.log('Universe ready');\n`);
chmodSync(fake, 0o755);
mkdirSync(path.join(home, '.agent-office'));
writeFileSync(path.join(home, '.agent-office', 'floors.json'), JSON.stringify([{ id: 'worlds-test', name: 'Universe Lab', dir: checkout, palette: 0, addedBy: 'test', addedAt: Date.now() }]));
const cfg = loadConfig(['--home', home, '--password', 'worlds-test', '--agent', fake, '--no-open']); cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
console.log(`Test office: ${base}`);
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');
const checks = [], errors = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
let browser, page;
const floor = office.floors().find(f => f.id === 'worlds-test');
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  console.log('Browser launched');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  assert.equal((await context.request.get(base + '/api/parallel-worlds?floor=worlds-test')).status(), 401);
  console.log('Unauthenticated route rejected');
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'worlds-test' } })).ok());
  console.log('Signed in');
  await context.addInitScript(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 0.5 });
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Universe tester', color: '#77a7ff', look: { skin: 0, hair: 0, style: 0 } }));
  });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/2d?floor=worlds-test');
  console.log('Office page loaded');
  await page.waitForFunction(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'worlds-test' && !window.__game2d.core.trip);
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
  console.log('Office ready');
  // Keep software WebGL affordable: retain the drawn scene while DOM/transport tests continue.
  // Draw the real scene once more when capturing the portals rather than filling the GPU queue.
  await page.evaluate(() => {
    const g = window.__game2d, effect = g.parts.stage.effect;
    const render = effect.render.bind(effect);
    window.__worldsDraw = () => render(g.ctx.scene, g.camera);
    effect.render = () => {};
    // First-person hand passes clear the drawing buffer even when their render is frozen.
    g.ctx.renderer.clearDepth = () => {};
  });
  async function menu() { await page.keyboard.press('Tab'); await page.getByRole('menuitem', { name: /Parallel worlds/ }).click(); }
  async function close() {
    await page.locator('.backdrop').last().locator('button.close').click();
    await page.waitForFunction(() => !document.querySelector('.backdrop') && window.__game2d.ctx.player.enabled && document.activeElement.id === 'scene');
  }
  await menu(); await page.getByLabel('Shared task', { exact: true }).fill('Build three ways to manage coding agents');
  console.log('Creation form ready');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'create.png'), timeout: 15000 });
  await page.getByRole('button', { name: 'Split into three worlds' }).click();
  await page.waitForSelector('.worlds-card', { timeout: 30000 });
  assert.equal(floor.workers.list().length, 3);
  const experiment = JSON.parse(readFileSync(path.join(checkout, '.agent-office', 'parallel-worlds.json'), 'utf8')).experiments[0];
  assert.equal(experiment.base, baseCommit);
  for (const worker of floor.workers.list()) {
    assert.equal(worker.worktree.base, baseCommit);
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(checkout, worker.worktree.path), encoding: 'utf8' }).trim(), baseCommit);
  }
  assert.equal(new Set(floor.workers.list().map(w => w.worktree.branch)).size, 3);
  check('authenticated launch creates three separate worktrees at the same commit');
  await page.waitForFunction(() => window.__game2d.store.services.items.length === 3, { timeout: 30000 });
  await page.getByRole('button', { name: 'Enter world', exact: true }).first().click();
  const room = page.getByRole('dialog', { name: 'Minimal universe', exact: true }); await room.waitFor();
  const frame = page.frameLocator('iframe[title="Minimal preview"]');
  // Invoke the preview's own click handler without GPU-dependent iframe coordinate delivery.
  await frame.getByRole('button', { name: 'Try this version' }).evaluate(button => button.click());
  await frame.getByRole('button', { name: 'Interaction verified' }).waitFor();
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'room.png') });
  check('world room loads a real discovered server and its interactive preview');
  await close(); await menu();
  await page.getByRole('button', { name: 'Select winner', exact: true }).first().click();
  await page.getByText('★ Selected universe').waitFor();
  await page.getByRole('button', { name: 'Open PR', exact: true }).waitFor();
  check('winner selection exposes explicit PR action without merging');
  await page.getByRole('button', { name: 'Enter world', exact: true }).first().click();
  await page.getByLabel('Feedback for Minimal').fill('Improve keyboard navigation');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await close(); await menu();
  await page.waitForFunction(() => !document.querySelector('.worlds-card.selected'));
  assert.equal(floor.workers.list().filter(w => w.activity === 'Improve keyboard navigation').length, 1);
  check('feedback targets one worker and invalidates its winner selection');
  await page.getByRole('button', { name: 'Compare previews side by side' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Compare universes' }).locator('iframe').count(), 3);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'compare.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.backdrop') && window.__game2d.ctx.player.enabled && document.activeElement.id === 'scene');
  check('comparison and Escape restore office controls');
  await page.evaluate(() => { const g = window.__game2d; g.parts.place.placeAt({ x: 0, y: 0, z: 6.8, rotY: Math.PI }); });
  await page.waitForTimeout(300); await page.evaluate(() => window.__worldsDraw());
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'portals.png') });
  await page.evaluate(() => { const g = window.__game2d; const it = g.ctx.usables.lists().flat().find(it => it.kind === 'worldportal' && it.deskId === '1'); if (!it) throw Error('No portal'); g.ctx.interactions.use(it, 'E', null); });
  await page.getByRole('dialog', { name: 'Visual universe', exact: true }).waitFor();
  await close();
  check('physical portal interaction opens its own world; close restores focus');
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__game2d.camera.isPerspectiveCamera);
  await page.evaluate(() => window.__game2d.parts.place.placeAt({ x: -1, y: 0, z: 5.5, rotY: Math.PI }));
  await page.waitForTimeout(300); await page.evaluate(() => {
    const g = window.__game2d;
    g.ctx.me.root.visible = false; // The normal first-person render hides the player's head before drawing.
    g.camera.position.set(-1, 1.4, 3.5); g.camera.lookAt(-1, 1.3, 8.5); g.camera.updateMatrixWorld();
    window.__worldsDraw();
  });
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'portals-3d.png') });
  await menu(); await page.getByRole('button', { name: 'Enter world', exact: true }).first().click(); await close();
  await page.waitForFunction(() => window.__game2d.ctx.player.mouseLook && window.__game2d.ctx.player.hasMouse);
  check('3D close restores mouse-look without another click');
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__game2d.camera.isOrthographicCamera);
  await menu(); await page.getByRole('button', { name: 'Enter world', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open agent terminal', exact: true }).click();
  await page.waitForSelector('.term'); assert.equal(await page.locator('.worlds-modal,.worlds-room').count(), 0);
  await close();
  await menu(); await page.getByRole('button', { name: 'Enter world', exact: true }).first().click();
  await page.getByRole('button', { name: 'Services / tunnels', exact: true }).click();
  await page.getByRole('dialog', { name: 'Services', exact: true }).waitFor();
  assert.equal(await page.locator('.worlds-modal,.worlds-room').count(), 0); await close();
  check('terminal and Services navigation leave no hidden experiment windows');
  await menu(); await page.getByRole('button', { name: 'Archive experiment' }).click();
  await page.getByRole('button', { name: 'Split into three worlds' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Split into three worlds' }).isEnabled(), true);
  assert.equal(floor.workers.list().length, 3);
  for (const worker of floor.workers.list()) assert.ok(existsSync(path.join(checkout, worker.worktree.path)));
  check('archive preserves workers and worktrees');
  await page.setViewportSize({ width: 700, height: 900 }); await page.screenshot({ animations: 'disabled', path: path.join(output, 'narrow.png') });
  await close();
  assert.deepEqual(errors, []); check('no browser runtime errors');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots: ['create.png', 'room.png', 'compare.png', 'portals.png', 'portals-3d.png', 'narrow.png'] }, null, 2));
} catch (err) { console.error('Verification failed:', err, 'Browser errors:', errors); if (page) await page.screenshot({ animations: 'disabled', path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {}); throw err; }
finally {
  await browser?.close();
  for (const worker of floor.workers.list()) await floor.workers.kill(worker.id, 'keep');
  office.shutdown();
}
console.log(`Evidence: ${output}`);
process.exit(0);
