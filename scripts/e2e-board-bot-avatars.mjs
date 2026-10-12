// Real client regression: board bot bodies must survive the initial zero-delta frame.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

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
  const stations = await page.evaluate(() => [...window.__office.world().desks.values()].filter(d => d.def.station).map(d => ({id:d.def.id,kind:d.def.station})));
  assert.equal(stations.length, 4);
  for (const { id, kind } of stations) {
    const evidence = await page.evaluate(id => {
      const o = window.__office, desk = o.world().desks.get(id);
      const root = desk.vacancy.children[0].children[0], body = root.children[0];
      root.updateWorldMatrix(true, true);
      const finite = [body.position, body.rotation, body.scale].every(v => [v.x,v.y,v.z].every(Number.isFinite)) && body.matrixWorld.elements.every(Number.isFinite);
      let visible = true;
      for (let p = body; p; p = p.parent) if (!p.visible) visible = false;
      const target = root.getWorldPosition(o.camera.position.clone());
      const render = window.__avatarRender ??= o.renderer.render.bind(o.renderer);
      o.renderer.shadowMap.enabled = false;
      o.renderer.render = (scene,camera) => { camera.position.set(target.x + 1.8, target.y + 1.4, target.z + 2.6); camera.lookAt(target.x, target.y + .65, target.z); render(scene,camera); };
      return { finite, visible };
    }, id);
    assert.deepEqual(evidence, { finite: true, visible: true }, kind + ' avatar');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(output, kind + '-bot.png') });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Issues, PR, Queue and Manager avatars have finite visible bodies from startup.');
} finally {
  await browser?.close();
  office.shutdown();
  process.env.PATH = previousPath;
}
