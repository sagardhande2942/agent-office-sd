// Reproducible desktop checks using the production bundle and an isolated real office.
// npm run build && node --import tsx scripts/e2e-game2d.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { DESKS, DESK_BY_ID, BOARDS, PLAN_REVIEW_TABLE, STATIONS } from '../src/shared/layout.ts';
import { deskPoint } from '../src/shared/nav.ts';

const output = path.resolve(process.env.GAME2D_ARTIFACTS ?? '/tmp/agent-office-game2d-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-game2d-'));
const floors = ['f1', 'f2'].map((id, i) => {
  const checkout = path.join(dir, id); mkdirSync(checkout);
  execFileSync('git', ['init', '-b', 'main'], { cwd: checkout, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: checkout, stdio: 'ignore' });
  return { id, name: `Test floor ${i + 1}`, dir: checkout, palette: i, addedBy: 'test', addedAt: Date.now() };
});
const data = path.join(dir, '.agent-office'); mkdirSync(data);
writeFileSync(path.join(data, 'floors.json'), JSON.stringify(floors));
const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'game2d-test', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');
let browser;
const checks = [], errors = [], sent = [];
const check = (name, evidence) => { checks.push({ name, status: 'passed', evidence }); console.log(`PASS ${name}: ${evidence}`); };
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: '2D tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', ws => ws.on('framesent', frame => { try { sent.push(JSON.parse(String(frame.payload))); } catch {} }));
  await page.goto(base + '/2d');
  await page.waitForURL('**/login?next=/2d');
  const response = await context.request.post(base + '/api/login', { data: { password: 'game2d-test' } }); assert.ok(response.ok());
  for (const route of ['/2d', '/2d.html', '/game2d.html']) { const r = await context.request.get(base + route); assert.equal(r.status(), 200); assert.match(await r.text(), /office-map/); }
  await page.goto(base + '/2d?floor=f2');
  await page.waitForFunction(() => window.__game2d?.playable());
  assert.equal(await page.locator('#floor').inputValue(), 'f2');
  assert.deepEqual(await page.evaluate(() => window.__game2d.interactions.kinds().sort()), ['board', 'desk', 'plans', 'station']);
  check('auth and direct routes', 'Signed-out /2d retains login next; three protected entry aliases serve the game; non-default floor selected.');
  await page.evaluate(() => { window.__game2d.walker.at = [8, 10]; });
  const before = await page.evaluate(() => [...window.__game2d.walker.at]);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => [...window.__game2d.walker.at]); assert.ok(after[0] > before[0] + 0.5);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW');
  assert.ok(await page.evaluate(() => window.__game2d.walker.at[1]) < after[1]);
  async function mapClick(x, z) {
    const at = await page.evaluate(({ x, z }) => { const g = window.__game2d, r = g.canvas.getBoundingClientRect(); return { x: r.left + g.transform.ox + x * g.transform.scale, y: r.top + g.transform.oz + z * g.transform.scale }; }, { x, z });
    await page.mouse.click(at.x, at.y);
  }
  await mapClick(8, 10);
  await page.waitForFunction(() => !window.__game2d.walker.path.length);
  assert.ok(await page.evaluate(() => Math.hypot(window.__game2d.walker.at[0] - 8, window.__game2d.walker.at[1] - 10)) < 0.2);
  await page.evaluate(() => { const g = window.__game2d; g.walker.at = [-14, -3.45]; });
  await page.keyboard.down('KeyD'); await page.waitForTimeout(900); await page.keyboard.up('KeyD');
  assert.ok(await page.evaluate(() => window.__game2d.walker.at[0]) < -12);
  assert.ok(await page.evaluate(() => window.__game2d.walker.nav.walkable(...window.__game2d.walker.at)));
  check('movement and collision', 'Arrows and WASD move; a ground click reaches its destination; holding D against a desk stays outside its blocked cells.');

  const floor = office.floors().find(f => f.id === 'f2');
  const shell = floor.workers.spawn(DESKS[0].id, 'e2e', undefined, false, 'shell'); assert.equal(typeof shell, 'object');
  await page.waitForFunction(id => window.__game2d.store.workers.has(id), shell.id);
  await page.waitForTimeout(500);
  async function closedControls(by = 'Escape') {
    assert.ok(await page.locator('.backdrop').count()); assert.ok(await page.locator('.backdrop').last().locator('button.close').count());
    const pos = await page.evaluate(() => [...window.__game2d.walker.at]);
    await page.keyboard.down('KeyS'); await page.waitForTimeout(100); await page.keyboard.up('KeyS');
    assert.deepEqual(await page.evaluate(() => [...window.__game2d.walker.at]), pos);
    if (by === 'Escape') await page.keyboard.press('Escape'); else await page.locator('.backdrop').last().locator('button.close').click();
    await page.waitForFunction(() => !document.querySelector('.backdrop'));
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'office-map');
    await page.evaluate(() => { window.__game2d.walker.at = [8, 10]; });
    await page.keyboard.down('KeyA'); await page.waitForTimeout(100); await page.keyboard.up('KeyA');
    assert.ok(await page.evaluate(() => window.__game2d.walker.at[0]) < 8);
  }
  const seat = DESK_BY_ID.get(shell.deskId), [sx, sz] = deskPoint(seat, 0, 0.9);
  await mapClick(sx, sz);
  await page.waitForSelector('.term');
  await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, 'terminal.png') });
  await page.keyboard.type('printf "GAME2D_TERMINAL_OK\\n"'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.ok(sent.some(m => m.t === 'term.input' && m.workerId === shell.id));
  await closedControls('close');
  await page.evaluate(({ x, z }) => { const g = window.__game2d; g.walker.at = g.walker.nav.nearestWalkable([x, z - 1.3]); }, { x: sx, z: sz });
  await page.keyboard.press('KeyE'); await page.waitForSelector('.term'); await closedControls();
  assert.equal(floor.workers.list().length, 1);
  check('worker terminal and focus', 'Map click and nearby E attach the existing real shell; input uses term.input; ✕ and Esc suspend and immediately restore movement without another click.');
  for (const label of ['Issues', 'PRs', 'Queue', 'Manager', 'Plan Comparison']) {
    await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForSelector('.backdrop');
    if (label === 'Plan Comparison') { await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, 'plans.png') }); }
    await closedControls(label === 'Manager' ? 'close' : 'Escape');
  }
  for (const id of ['issues', 'pulls', 'queue']) { await mapClick(BOARDS[id].x, BOARDS[id].z); await closedControls(); }
  await mapClick(PLAN_REVIEW_TABLE.x, PLAN_REVIEW_TABLE.z); await closedControls();
  const manager = STATIONS.find(s => s.id === 'station-manager');
  await mapClick(manager.x, manager.z); await closedControls();
  check('existing dialogs', 'Issues, PRs, Queue, Manager and Plan Comparison open from both HUD and map; each has ✕, consumes Esc, and restores canvas controls.');
  await page.getByRole('button', { name: 'Prompt', exact: true }).click(); await closedControls();
  await page.getByRole('button', { name: 'Helper', exact: true }).click(); await closedControls();
  await page.getByRole('button', { name: 'Send home', exact: true }).click(); await closedControls('close');
  await page.getByRole('button', { name: 'New task', exact: true }).click(); await closedControls();
  check('worker action dialogs', 'Shared prompt, helper, send-home confirmation and provider/repository hiring dialogs open and cancel without spawning or killing a worker.');

  // Exercise real queue APIs with dispatch paused, then nested board dialogs using a local fixture.
  await page.evaluate(() => window.__game2d.net.send({ t: 'queue.limit', maxWorkers: 0 }));
  await page.waitForFunction(() => window.__game2d.store.queue.maxWorkers === 0);
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await page.getByLabel('New task', { exact: true }).fill('E2E paused queue task');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.waitForFunction(() => window.__game2d.store.queue.tasks.some(t => t.prompt === 'E2E paused queue task'));
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(() => !window.__game2d.store.queue.tasks.length);
  await closedControls();
  const issue = { number: 4242, title: 'Local nested-dialog fixture', state: 'OPEN', url: 'https://github.com/example/test/issues/4242', author: 'test', labels: [], assignees: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), body: 'Test fixture', comments: 0 };
  await page.route('**/api/gh/issue?*', route => route.fulfill({ json: { number: 4242, state: 'OPEN', body: 'Test fixture', comments: [], forge: 'github', viewer: 'test' } }));
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  await page.evaluate(issue => { window.__game2d.store.issues = { items: [issue], fetchedAt: Date.now(), loading: false }; window.__game2d.store.emit('issues'); }, issue);
  await page.locator('li.card').filter({ hasText: issue.title }).click();
  await page.getByRole('button', { name: 'Close issue…', exact: false }).click();
  assert.equal(await page.locator('.backdrop').count(), 3);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.backdrop').count(), 2);
  assert.equal(await page.evaluate(() => window.__game2d.controls()), false);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.backdrop').count(), 1);
  await closedControls();
  check('nested dialogs and queue APIs', 'Real queue.limit/add/remove run against the isolated floor; Escape unwinds three nested board/issue/confirmation dialogs while controls remain suspended.');

  // Capture provider-producing requests instead of starting external agents.
  await page.evaluate(() => {
    const g = window.__game2d; g.actionRequests = []; g.originalSend = g.net.send.bind(g.net);
    g.net.send = message => { g.actionRequests.push(message); if (!['worker.spawn', 'worker.helper', 'station.prompt'].includes(message.t)) g.originalSend(message); };
  });
  await page.getByRole('button', { name: 'Helper', exact: true }).click();
  await page.locator('form.modal').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => window.__game2d.actionRequests.some(m => m.t === 'worker.helper'));
  await page.getByRole('button', { name: 'Manager', exact: true }).click();
  await page.locator('.modal textarea').fill('Report blockers');
  await page.locator('form.modal').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => window.__game2d.actionRequests.some(m => m.t === 'station.prompt' && m.deskId === 'station-manager' && m.prompt === 'Report blockers'));
  const free = DESKS[7], [fx, fz] = deskPoint(free, 0, 0.9);
  await mapClick(fx, fz); await page.locator('.modal textarea').fill('Fixture task');
  await page.locator('form.modal').evaluate(form => form.requestSubmit());
  await page.waitForFunction(id => window.__game2d.actionRequests.some(m => m.t === 'worker.spawn' && m.deskId === id && m.prompt === 'Fixture task'), free.id);
  await page.evaluate(() => { const g = window.__game2d; g.net.send = g.originalSend; });
  assert.equal(floor.workers.list().length, 1);
  check('existing action contracts', 'Runtime helper, Manager and hiring forms emit existing worker.helper/station.prompt/worker.spawn requests; provider launches are captured as fixtures.');

  const peer = await context.newPage(); peer.on('pageerror', e => errors.push(e.message));
  await peer.goto(base + '/2d?floor=f2'); await peer.waitForFunction(() => window.__game2d?.playable());
  const peerId = await peer.evaluate(() => window.__game2d.store.you);
  await page.waitForFunction(id => window.__game2d.peers.has(id), peerId);
  await peer.keyboard.down('KeyD'); await peer.waitForTimeout(300); await peer.keyboard.up('KeyD');
  const peerAt = await peer.evaluate(() => [...window.__game2d.walker.at]);
  await page.waitForFunction(({ id, at }) => Math.hypot(window.__game2d.store.peers.get(id).x - at[0], window.__game2d.store.peers.get(id).z - at[1]) < 0.1, { id: peerId, at: peerAt });
  await peer.locator('#floor').selectOption('f1'); await peer.waitForFunction(() => window.__game2d.store.floor === 'f1');
  await page.waitForFunction(id => !window.__game2d.peers.has(id), peerId);
  await peer.close();
  check('multiplayer', 'Two authenticated 2D pages exchange actual move frames; the other player disappears on floor change and disconnect.');

  // Status fixtures use the same server update event as real workers, with no provider calls.
  const fixtures = [];
  for (const [i, status] of ['working', 'needs_input', 'done', 'offline'].entries()) {
    const w = floor.workers.spawn(DESKS[i + 1].id, 'fixture', undefined, false, 'shell'); assert.equal(typeof w, 'object');
    w.name = `Status ${status}`; w.status = status; floor.workers.events.update({ ...w }); fixtures.push(w);
  }
  await page.waitForFunction(() => window.__game2d.store.workers.size === 5);
  for (const status of ['working', 'needs input', 'done', 'offline']) assert.ok(await page.getByRole('button', { name: new RegExp(`Status .* · ${status}`) }).count());
  await page.waitForFunction(() => !document.querySelector('.toast'));
  await page.screenshot({ path: path.join(output, 'office-1440.png') });
  await page.setViewportSize({ width: 1120, height: 760 }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(output, 'office-1120.png') });
  check('map and worker statuses', 'Desktop screenshots at 1440×900 and 1120×760 show placeholder Office fixtures, named workers, and live working/needs input/done/offline labels.');

  const identities = floor.workers.list().map(w => ({ id: w.id, sessionId: w.sessionId }));
  const boundary = sent.length;
  await page.getByLabel('View', { exact: true }).selectOption('/lite'); await page.waitForFunction(() => window.__lite?.store.floor === 'f2');
  await page.getByLabel('View', { exact: true }).selectOption('/'); await page.waitForFunction(() => window.__office?.store.floor === 'f2', null, { timeout: 60000 });
  // Real 3D peer observes the 2D client's physical coordinates.
  const gamePeer = await context.newPage(); await gamePeer.goto(base + '/2d?floor=f2'); await gamePeer.waitForFunction(() => window.__game2d?.playable());
  const gameId = await gamePeer.evaluate(() => window.__game2d.store.you);
  await page.waitForFunction(id => window.__office.store.peers.has(id), gameId);
  await gamePeer.keyboard.down('KeyD'); await gamePeer.waitForTimeout(250); await gamePeer.keyboard.up('KeyD');
  const physical = await gamePeer.evaluate(() => window.__game2d.walker.at[0]);
  await page.waitForFunction(({ id, x }) => Math.abs(window.__office.store.peers.get(id).x - x) < 0.1, { id: gameId, x: physical });
  await gamePeer.waitForFunction(() => [...window.__game2d.store.peers.values()].some(p => p.id !== window.__game2d.store.you && !p.lite && p.floor === 'f2'));
  await gamePeer.close();
  await page.locator('#dock [data-action=views]').click();
  await page.locator('.backdrop button.close').click();
  await page.waitForFunction(() => window.__office.player.enabled && document.activeElement?.id === 'scene');
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.enabled && document.activeElement?.id === 'scene');
  check('3D focus regression', 'Closing the 3D View dialog restores canvas focus, enabled controls and mouse-look without another click.');
  await page.keyboard.press('Tab');
  await page.getByRole('menuitem', { name: /View: 3D/ }).click();
  await page.getByLabel('View', { exact: true }).selectOption('/2d'); await page.waitForFunction(() => window.__game2d?.playable());
  assert.deepEqual(floor.workers.list().map(w => ({ id: w.id, sessionId: w.sessionId })), identities);
  assert.ok(!sent.slice(boundary).some(m => ['worker.spawn', 'worker.resume'].includes(m.t)));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => [...window.__game2d.store.peers.values()].filter(p => p.floor === 'f2').length), 1);
  check('view switching and 3D interoperability', '2D → Lite → 3D → 2D retains floor f2 and all worker/session IDs, sends no spawn/resume, leaves one peer; a 3D page receives real 2D player movement.');
  // A dropped transport reconnects once and reattaches the currently open terminal.
  await page.locator('.worker-open').first().click(); await page.waitForSelector('.term');
  const oldYou = await page.evaluate(() => window.__game2d.store.you);
  const reconnectFrom = sent.length;
  await page.evaluate(() => window.__game2d.net.ws.close());
  await page.waitForFunction(id => window.__game2d.playable() && window.__game2d.store.you !== id, oldYou);
  await page.waitForTimeout(250);
  assert.equal(sent.slice(reconnectFrom).filter(m => m.t === 'worker.attach' && m.workerId === shell.id).length, 1);
  await closedControls();
  check('reconnect lifecycle', 'Dropping the socket reconnects once and sends exactly one worker.attach for the open terminal.');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('View', { exact: true }).selectOption('/lite');
    await page.waitForFunction(() => window.__lite?.store.floor === 'f2');
    await page.getByLabel('View', { exact: true }).selectOption('/2d');
    await page.waitForFunction(() => window.__game2d?.playable() && window.__game2d.store.floor === 'f2');
  }
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => [...window.__game2d.store.peers.values()].filter(p => p.floor === 'f2').length), 1);
  assert.deepEqual(floor.workers.list().map(w => ({ id: w.id, sessionId: w.sessionId })), identities);
  check('repeated switching', 'Two additional rapid Lite/2D round trips preserve worker sessions and leave exactly one positioned peer.');
  await page.evaluate(() => {
    const g = window.__game2d; g.messages.dispatch({ t: 'map', state: { pick: 'castle', custom: [] } });
  });
  await page.getByRole('status').filter({ hasText: 'Office only' }).waitFor();
  assert.equal(await page.evaluate(() => window.__game2d.controls()), false);
  await page.evaluate(() => window.__game2d.messages.dispatch({ t: 'map', state: { pick: 'office', custom: [] } }));
  assert.equal(await page.evaluate(() => window.__game2d.store.floor), 'f2');
  check('Office-only guard', 'An unsupported-map fixture disables game input and shows the view-switch notice while retaining the selected floor.');
  assert.deepEqual(errors, []);
  check('browser runtime', 'No page errors across 2D, Lite and 3D.');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots: ['office-1440.png', 'office-1120.png', 'terminal.png', 'plans.png'] }, null, 2));
} finally {
  await browser?.close(); office.shutdown();
}
console.log(`Evidence: ${output}`);
process.exit(0);
