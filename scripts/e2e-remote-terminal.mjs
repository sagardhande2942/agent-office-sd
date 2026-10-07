// Production browser + real office + paired host fixture with 600ms delayed echo.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import { Hosts } from '../src/server/hosts.ts';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-remote-term-'));
const data = path.join(dir, '.agent-office'); mkdirSync(data);
const hosts = new Hosts(data), paired = hosts.claim(hosts.pair('test').code, 'Delayed laptop', 'test');
assert.notEqual(typeof paired, 'string');
writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'remote', host: paired.host.id, repo: 'fixture/app', name: 'Delayed remote floor', dir: '/remote/fixture', palette: 0, addedBy: 'test', addedAt: Date.now() }]));
const cfg = loadConfig(['--home', dir, '--password', 'fixture', '--no-open']); cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const socket = new WebSocket(base.replace('http:', 'ws:') + '/floor-host');
const send = m => socket.send(JSON.stringify(m));
const inputs = [], received = [], timers = new Set();
const worker = { id: 'fixture-worker', deskId: 'desk-1', name: 'Delayed shell', color: '#ef476f', kind: 'shell', status: 'idle', task: 'Echo fixture', viewers: [], viewerIds: [], cols: 80, rows: 24, startedAt: Date.now() };
socket.on('open', () => send({ t: 'hello', protocol: 1, hostId: paired.host.id, token: paired.token }));
socket.on('message', raw => {
  const m = JSON.parse(String(raw)); received.push(m);
  if (m.t === 'welcome') {
    send({ t: 'ready', floor: { floorId: 'remote', name: 'Delayed remote floor', seats: 5, accepting: false, forge: 'github', branch: 'main', providers: ['claude'], workers: [worker] } });
    send({ t: 'event', floorId: 'remote', seq: 0, msg: { t: 'worker.update', worker } });
  } else if (m.t === 'worker.attach') send({ t: 'result', floorId: 'remote', seq: m.seq, value: { data: '$ ', cols: 80, rows: 24 } });
  else if (m.t === 'term.input') {
    inputs.push(m);
    const timer = setTimeout(() => { timers.delete(timer); send({ t: 'term.data', floorId: 'remote', workerId: worker.id, data: m.data === '\r' ? '\r\n$ ' : m.data }); }, 600); timers.add(timer);
  } else if (m.seq) send({ t: 'result', floorId: 'remote', seq: m.seq, value: null });
});
const output = '/tmp/agent-office-remote-terminal-evidence'; mkdirSync(output, { recursive: true });
let browser;
try {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const executablePath = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Typing tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } })));
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'fixture' } })).ok());
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(base + '/lite?floor=remote');
  console.log('Loaded remote floor');
  await page.getByRole('button', { name: /terminal/i }).first().click();
  console.log('Opened remote terminal');
  const draft = page.getByRole('textbox', { name: 'Local terminal draft' });
  await page.waitForFunction(() => !document.querySelector('.remote-terminal-draft button[type=submit]')?.disabled);
  await draft.pressSequentially('echo immediate local editing', { delay: 5 });
  await draft.press('Shift+Enter');
  assert.equal(inputs.length, 0);
  assert.equal(await draft.inputValue(), 'echo immediate local editing\n');
  await draft.press('Backspace');
  assert.equal(inputs.length, 0, 'draft editing makes no PTY round trips');
  assert.equal(await draft.inputValue(), 'echo immediate local editing');
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await draft.press('Enter');
  await page.waitForTimeout(250);
  assert.deepEqual(inputs.map(m => m.data), ['echo immediate local editing', '\r']);
  assert.ok(inputs.every(m => m.seq === 0));
  assert.equal(await draft.inputValue(), '');
  await draft.fill('unsent draft');
  await page.keyboard.press('Escape');
  await page.locator('.backdrop').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /terminal/i }).first().click();
  console.log('Opened remote terminal');
  assert.equal(await draft.inputValue(), 'unsent draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await draft.fill('insert only');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.waitForTimeout(200);
  assert.deepEqual(inputs.map(m => m.data), ['echo immediate local editing', '\r', 'insert only']);
  await page.getByRole('button', { name: 'Tab', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(inputs.at(-1).data, '\t', 'direct keypad controls still reach the host');
  await page.locator('.backdrop button.close').click();
  await page.locator('.backdrop').waitFor({ state: 'detached' });
  // Keep actual game/player/focus logic; suppress scene draws on headless software WebGL.
  const game = await context.newPage();
  await game.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(time => { if (window.__office?.renderer) window.__office.renderer.render = () => {}; callback(time); });
  });
  await game.goto(base + '/?floor=remote');
  await game.waitForFunction(() => window.__office?.net.up && window.__office.store.workers.size && window.__office.player.enabled);
  await game.locator('#loading').waitFor({ state: 'hidden' });
  for (const close of ['Escape', 'button']) {
    await game.keyboard.press('Control+k');
    const search = game.getByRole('combobox', { name: 'Find anything in the office' });
    await search.fill('Delayed shell'); await search.press('Enter');
    await game.getByRole('textbox', { name: 'Local terminal draft' }).waitFor();
    if (close === 'Escape') await game.keyboard.press('Escape'); else await game.locator('.backdrop button.close').click();
    await game.waitForFunction(() => !document.querySelector('.backdrop') && window.__office.player.hasMouse);
  }
  await game.close();
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ echoDelayMs: 600, checks: ['draft edits send zero input', 'Enter sends ordered paste and return with seq=0', 'Insert sends no return', 'Shift+Enter edits locally', 'direct keypad controls reach the remote host', 'draft survives close', 'mobile fits', 'Escape and close button restore actual game mouse-look'] }, null, 2));
  console.log('PASS remote typing with 600ms echo delay; evidence: ' + output);
} catch (error) { console.error(error); console.error('Host frames:', received.map(m => ({t:m.t,seq:m.seq,workerId:m.workerId}))); process.exitCode = 1; }
finally { for (const t of timers) clearTimeout(t); await browser?.close(); socket.close(); office.shutdown(); }
process.exit(process.exitCode ?? 0);
