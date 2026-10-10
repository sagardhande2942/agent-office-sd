// Real office, real paired host socket, authenticated worker CLI, and two browser viewers.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { Hosts } from '../src/server/hosts.ts';
import { HostFloors, hostParts, startHooks } from '../src/server/host-floor.ts';
import { FLOORHOST_PROTOCOL } from '../src/shared/floorhost.ts';
const dir = mkdtempSync(path.join(tmpdir(), 'remote-cinema-e2e-'));
const output = path.resolve(process.env.CINEMA_ARTIFACTS ?? '/tmp/agent-office-remote-cinema-evidence');
mkdirSync(output, { recursive: true });
const checks = [], errors = [];
const check = (name, ok) => { checks.push({ name, passed: !!ok }); if (!ok) throw new Error(name); console.log(`PASS ${name}`); };
const wait = async (fn) => { for (let i = 0; i < 300; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out'); };
const home = path.join(dir, 'office'), checkout = path.join(dir, 'remote');
mkdirSync(home); mkdirSync(checkout);
execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
execFileSync('git', ['-C', checkout, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
const cfg = loadConfig(['--home', home, '--password', 'remote-cinema', '--no-open']); cfg.port = 0;
const hosts = new Hosts(cfg.dataDir), code = hosts.pair('Tester');
if (typeof code === 'string') throw new Error(code);
const paired = hosts.claim(code.code, 'Remote cinema host'); if (typeof paired === 'string') throw new Error(paired);
writeFileSync(path.join(cfg.dataDir, 'floors.json'), JSON.stringify([{ id: 'remote', name: 'Remote demo', dir: checkout, palette: 0, addedBy: 'Tester', addedAt: Date.now(), host: paired.host.id }]));
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let ws, host, browser;
const hooks = await startHooks(id => host?.floorOf(id)?.workers, { floorOf: id => host?.floorOf(id), changed: f => host.reportCinema(f.id, f) });
const agent = path.join(dir, 'agent'); writeFileSync(agent, `#!${process.execPath}\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
const connect = async () => {
  ws = new WebSocket(base.replace('http', 'ws') + '/floor-host');
  host = new HostFloors(hostParts({ dataDir: path.join(dir, 'host-data'), agentCmd: agent, agentArgs: [], dshProfile: 'acp' }, m => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)), hooks.url, 2));
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', hostId: paired.host.id, token: paired.token, protocol: FLOORHOST_PROTOCOL })));
  ws.on('message', raw => { const m = JSON.parse(String(raw)); if (m.t === 'welcome') void host.open(m.floors); else void host.call(m); });
  await wait(() => host.floors.get('remote')?.project);
};
try {
  await connect();
  const worker = await host.floors.get('remote').workers.spawn('desk-1', 'Tester', 'record a demo', false, 'agent');
  if (typeof worker === 'string') throw new Error(worker);
  const token = JSON.parse(readFileSync(path.join(checkout, '.agent-office/workers.json'), 'utf8')).find(w => w.id === worker.id).hookToken;
  const env = { ...process.env, AGENT_OFFICE_HOOK_URL: hooks.url, AGENT_OFFICE_WORKER_ID: worker.id, AGENT_OFFICE_HOOK_TOKEN: token };
  const cli = (args, body = '') => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['bin/office-workers.js', 'cinema', ...args, '--json'], { env }); let out = '', err = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.stdin.end(body);
    c.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/home/tradeai/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const pages = [];
  for (const name of ['Host viewer', 'Friend viewer']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(name => { localStorage.setItem('agent-office.profile', JSON.stringify({ name, color: '#4cc9f0', look: { skin: 0, hair: 0, style: 0 } })); localStorage.setItem('agent-office.lite-declined', '1'); }, name);
    check('browser login ' + name, (await ctx.request.post(base + '/api/login', { data: { password: 'remote-cinema' } })).ok());
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.waitForFunction(() => window.__office?.net.up, null, { timeout: 60000 });
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 60000 }); pages.push(page);
  }
  const png = await pages[0].screenshot();
  const added = await cli(['add'], JSON.stringify({ title: 'Remote feature demo', shots: [
    { caption: 'The actual office build viewed from the remote floor', image: `data:image/png;base64,${png.toString('base64')}` },
    { caption: 'A second captioned step shared with a friend', image: `data:image/png;base64,${png.toString('base64')}` },
  ] }));
  const reel = added.reel.id;
  check('remote worker CLI adds and lists a reel', (await cli(['list'])).reels[0].id === reel);
  for (const page of pages) {
    await page.waitForFunction(reel => window.__office.store.cinema.reels.some(r => r.id === reel), reel);
    await page.evaluate(() => { const p = window.__office.player, it = window.__office.office.interactables.find(i => i.kind === 'cinema'); p.pos.set(it.x, 0, it.z - 1.2); p.facing = 0; p.updateCamera?.(true); });
    await page.waitForTimeout(500); await page.locator('#scene').click({ position: { x: 700, y: 700 } }); await page.waitForTimeout(500); await page.keyboard.press('KeyE');
    await page.getByRole('dialog', { name: 'Screening room' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.cinema-shot')?.naturalWidth > 0);
  }
  check('both viewers open with E and load the remote PNG', true);
  await pages[0].getByRole('button', { name: 'On the screen' }).click();
  await pages[0].locator('button[title="Pause where it is"]').click();
  for (const p of pages) await p.waitForFunction(() => !window.__office.store.cinema.playing);
  const states = await Promise.all(pages.map(p => p.evaluate(() => window.__office.store.cinema)));
  check('pause and timeline are shared by both viewers', states[0].at === states[1].at && states[0].frame === states[1].frame && states[0].reel === states[1].reel);
  const next = (states[0].frame + 1) % 2;
  await pages[0].locator('button[title="On a shot"]').click();
  for (const p of pages) await p.waitForFunction(n => window.__office.store.cinema.frame === n && window.__office.store.cinema.playing, next);
  check('stepping a shot updates both viewers', true);
  await pages[0].locator('button[title="Pause where it is"]').click();
  for (const p of pages) await p.waitForFunction(() => !window.__office.store.cinema.playing);
  await pages[0].screenshot({ path: path.join(output, 'remote-screening-host.png') });
  await pages[1].screenshot({ path: path.join(output, 'remote-screening-friend.png') });
  const shotUrl = `${base}/api/cinema/shot?floor=remote&reel=${reel}&n=0`;
  check('unknown shot refused', (await pages[0].request.get(shotUrl.replace('n=0', 'n=99'))).status() === 404);
  check('worker upload rejects invalid credentials', (await fetch(`${hooks.url}/office/workers/cinema?worker=${worker.id}`, { headers: { authorization: 'Bearer wrong' } })).status === 401);
  ws.close(); await wait(() => ws.readyState === WebSocket.CLOSED); host.shutdown();
  await wait(async () => (await pages[0].request.get(shotUrl)).status() === 503);
  check('disconnected host returns an explicit 503', true);
  await connect();
  await wait(async () => (await pages[0].request.get(shotUrl)).status() === 200);
  check('reconnecting restores saved reels and their PNGs', true);
  await pages[0].locator('button[title="Turn the screen off"]').click();
  for (const p of pages) await p.waitForFunction(() => !window.__office.store.cinema.on);
  check('stop works after reconnect for both viewers', true);
  await cli(['remove', reel]);
  for (const p of pages) await p.waitForFunction(() => !window.__office.store.cinema.reels.length);
  check('removed remote reel cannot be fetched', (await pages[0].request.get(shotUrl)).status() === 404);
  await pages[0].keyboard.press('Escape');
  await pages[0].waitForFunction(() => !document.querySelector('.backdrop') && window.__office.player.hasMouse);
  check('Esc restores mouse look', true);
  check('no browser runtime errors', errors.length === 0);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
} finally { ws?.close(); host?.shutdown(); hooks.close(); await browser?.close(); office.shutdown(); rmSync(dir, { recursive: true, force: true }); }
process.exit(0);
