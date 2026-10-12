// Real client regression: Boss roles must never suppress hired desk avatars.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { DESKS } from '../src/shared/layout.ts';

const output = path.resolve(process.env.AVATAR_ARTIFACTS ?? '/tmp/agent-office-avatar-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-avatars-'));
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
// Keep the fixture independent of installed agent CLIs and account usage readers.
const previousPath = process.env.PATH;
if (process.platform === 'win32') {
  const npmShims = path.join(process.env.APPDATA ?? '', 'npm').toLowerCase();
  process.env.PATH = previousPath.split(path.delimiter).filter(entry => path.resolve(entry).toLowerCase() !== npmShims).join(path.delimiter);
}
const config = loadConfig([dir, '--password', 'avatar-test', '--no-open', '--agent', process.execPath]);
config.port = 0;
const office = await startServer(config, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await context.addInitScript(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Avatar tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } })));
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'avatar-test' } })).ok());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?3d=1');
  await page.waitForFunction(() => window.__office?.net.up && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });
  const ids = ['boss-fixture', 'master-fixture', 'discovery-fixture', 'worker-fixture'];
  // Inject protocol fixtures into this isolated client's store; no agent processes or paid calls.
  await page.evaluate(({ ids, desks }) => {
    const o = window.__office;
    ids.forEach((id, i) => o.store.apply({ t: 'worker.update', worker: {
      id, name: ['Boss coordinator', 'Team master', 'Discovery', 'Worker'][i],
      deskId: desks[i].id, kind: 'agent', provider: 'codex', color: ['#e8c547', '#06d6a0', '#ef476f', '#118ab2'][i],
      status: 'working', acked: true, createdBy: 'Avatar tester', createdAt: Date.now(),
      ...(i === 0 ? { bossMode: { floor: o.store.floor, role: 'boss' } } : {}),
    } }));
    o.store.bossMode.enabled = true;
    o.store.bossMode.discovery = { id: 'fixture', workerId: ids[2], startedAt: Date.now() };
    o.store.bossMode.team = { presets: [], current: { masterId: ids[1] } };
    o.store.bossMode.presence = { path: [[desks[0].x + 2, 0, desks[0].z + 2]], startedAt: Date.now(), speed: 1, face: 0, activity: 'Checking workers' };
    o.player.pos.set(desks[0].x + 4, 0, desks[0].z + 5);
  }, { ids, desks: DESKS.slice(0, 4) });
  // Let multiple real animation ticks run before checking all ancestor visibility.
  await page.waitForTimeout(500);
  const visible = () => page.evaluate(ids => ids.map(id => {
    const model = window.__office.workerViews.get(id)?.model;
    if (!model) return false;
    for (let p = model.body; p; p = p.parent) if (!p.visible) return false;
    return model.body.children.some(p => p.isMesh && p.visible);
  }), ids);
  assert.deepEqual(await visible(), [true, true, true, true]);
  assert.equal(await page.evaluate(() => window.__office.scene.getObjectByName('boss-mode-avatar').visible), true);
  await page.evaluate(() => {
    const o = window.__office;
    o.renderer.shadowMap.enabled = false;
    o.camera.position.set(o.player.pos.x, 3.5, o.player.pos.z);
    const target = o.workerViews.get('boss-fixture').model.root.getWorldPosition(o.camera.position.clone());
    const render = o.renderer.render.bind(o.renderer);
    o.renderer.render = (scene, camera) => { camera.position.set(target.x + 5, 4, target.z + 6); camera.lookAt(target.x, 1, target.z); render(scene, camera); };
  });
  await page.screenshot({ path: path.join(output, 'boss-and-worker-avatars.png') });
  await page.evaluate(() => {
    const state = window.__office.store.bossMode;
    state.enabled = false; state.discovery = undefined; state.team = undefined; state.presence = undefined;
    window.__office.store.workers.get('boss-fixture').bossMode = undefined;
  });
  await page.waitForTimeout(500);
  assert.deepEqual(await visible(), [true, true, true, true]);
  assert.deepEqual(errors, []);
  console.log('PASS: all four desk avatars stay visible with Boss mode on and after roles clear.');
} finally {
  await browser?.close();
  office.shutdown();
  process.env.PATH = previousPath;
}
