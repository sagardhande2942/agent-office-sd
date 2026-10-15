// npm run build && CHROMIUM_PATH=/path/to/chrome node --import tsx scripts/e2e-meeting-portals.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOF } from '../src/shared/rooftop.ts';
import { chromium } from 'playwright-core';
import { knowledgeFixture, browserPath } from './support/knowledge-fixture.mjs';
// Font-ready evaluation can stall behind software WebGL rendering in headless Chromium.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const output = path.resolve(process.env.MEETING_PORTALS_ARTIFACTS ?? '/tmp/agent-office-meeting-portals-evidence'); mkdirSync(output, { recursive: true });
const f = await knowledgeFixture(), checks = [], errors = [];
let browser;
const check = name => { checks.push(name); console.log('PASS ' + name); };
try {
  f.floor.meetings.create('Architecture review');
  const otherId = f.floor.meetings.state().spaces[1].id;
  for (const [spaceId, title] of [['main', 'Release planning'], [otherId, 'Architecture review']]) {
    assert.equal(f.floor.meetings.start({ spaceId, pattern: 'debate', prompt: 'Compare design tradeoffs', title, roles: ['Chair', 'Skeptic'], rounds: 2 }, 'Fixture'), undefined);
  }
  browser = await chromium.launch({ executablePath: browserPath(), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const makeViewer = async (route = '/?3d=1&floor=local', reduced = false) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await context.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Reality explorer', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
      localStorage.setItem('agent-office.lite-declined', '1');
      localStorage.setItem('agent-office.settings', JSON.stringify({ volume: 0, muted: true }));
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(ts => {
        const o = window.__office;
        if (o && !o.renderer.__portalHarness) {
          o.renderer.__portalHarness = true; const render = o.renderer.render.bind(o.renderer);
          o.renderer.render = (scene, camera) => {
            if (scene === o.scene) {
              if (!window.__renderPortalWorld) return;
              window.__renderPortalWorld = false; render(scene, camera); return;
            }
            // Keep the destination scene live; skip unrelated first-person hand passes.
            if (scene.background) render(scene, camera);
          };
          o.renderer.setPixelRatio(0.65);
        }
        cb(ts);
      });
    });
    assert.ok((await context.request.post(f.base + '/api/login', { data: { password: 'knowledge-fixture' } })).ok());
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(m.text())) errors.push(m.text()); });
    await page.goto(f.base + route);
    await page.waitForFunction(() => window.__office?.net.up && window.__office.store.floor === 'local' && window.__office.player.enabled);
    await page.waitForSelector('#loading', { state: 'hidden' });
    await page.evaluate(() => { window.__office.renderer.setPixelRatio(0.65); });
    return page;
  };
  const page = await makeViewer();
  const anchor = p => p.getByRole('dialog', { name: 'Reality Anchor', exact: true });
  const open = async p => { await p.keyboard.press('Tab'); await p.getByRole('menuitem', { name: /Reality Anchor/ }).click(); await anchor(p).waitFor(); };
  const choose = async (p, name) => { await anchor(p).getByRole('button', { name: `Preview ${name}`, exact: true }).click(); await anchor(p).getByRole('heading', { name, exact: true }).waitFor(); };
  await open(page);
  await anchor(page).getByRole('heading', { name: 'Architecture review', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.reality-aperture canvas'); const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    return data && data.some((value, i) => i % 4 !== 3 && value > 40);
  });
  assert.equal(await page.evaluate(() => window.__office.store.selectedMeetingSpace), 'main');
  assert.equal(f.floor.workers.list().length, 4);
  await page.screenshot({ timeout: 90000, path: path.join(output, 'reality-anchor-desktop.png') });
  check('Live 3D destination preview renders real meeting agents without changing selection or hiring');
  await anchor(page).getByRole('button', { name: 'Next reality', exact: true }).click();
  await anchor(page).getByRole('heading', { name: 'Main meeting', exact: true }).waitFor();
  await anchor(page).getByRole('button', { name: 'Previous reality', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene' && window.__office.player.hasMouse);
  assert.equal(await page.evaluate(() => window.__office.store.selectedMeetingSpace), 'main'); check('Dial previews wrap and Esc cancels with immediate scene controls');
  const second = await makeViewer();
  await open(page); await choose(page, 'Architecture review');
  await anchor(page).getByRole('button', { name: 'Enter now', exact: true }).click();
  await page.waitForFunction(id => window.__office.store.selectedMeetingSpace === id, otherId);
  assert.equal(await second.evaluate(() => window.__office.store.selectedMeetingSpace), 'main');
  await page.waitForFunction(() => !document.querySelector('.reality-crossing'));
  assert.equal(f.floor.meetings.state().spaces.every(s => s.current?.status === 'running'), true);
  check('Cinematic crossing changes only this viewer; both meetings keep running');
  await open(page); await choose(page, 'Main meeting');
  await anchor(page).getByLabel('Instant transition').check();
  await anchor(page).getByRole('button', { name: 'Open doorway', exact: true }).click();
  await page.waitForFunction(() => window.__office.scene.getObjectByName('meeting-reality-doorway')?.visible);
  await page.evaluate(() => {
    const o = window.__office, root = o.scene.getObjectByName('meeting-reality-anchor');
    o.player.pos.set(root.position.x, 0, root.position.z - 2.5); o.player.view = 'first'; o.player.camYaw = Math.PI; o.player.lookPitch = -0.06;
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.__renderPortalWorld = true; });
  await page.waitForTimeout(1200);
  await page.screenshot({ timeout: 90000, path: path.join(output, 'reality-doorway-world.png') });
  await page.evaluate(() => { window.__renderPortalWorld = false; });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__office.store.selectedMeetingSpace === 'main'); await page.keyboard.up('KeyW');
  await page.waitForFunction(() => !document.querySelector('.reality-crossing'));
  assert.equal(await page.locator('.reality-crossing').count(), 0);
  check('Walking across the physical doorway switches the meeting reality and respects instant transition');
  await open(page); await anchor(page).getByRole('button', { name: '+ New reality', exact: true }).click();
  await anchor(page).getByLabel('New reality name').fill('Unwritten future'); await anchor(page).getByRole('button', { name: 'Create reality', exact: true }).click();
  await anchor(page).getByRole('heading', { name: 'Unwritten future', exact: true }).waitFor();
  assert.equal(f.floor.workers.list().length, 4); assert.equal(await page.evaluate(() => window.__office.store.selectedMeetingSpace), 'main');
  await anchor(page).getByLabel('Instant transition').check(); await anchor(page).getByRole('button', { name: 'Enter now', exact: true }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current === null && window.__office.store.selectedMeetingSpace !== 'main');
  assert.equal(await page.locator('.reality-crossing').count(), 0); check('Creating an unwritten reality hires nobody and instant entry changes no meeting workflow');
  await open(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ timeout: 90000, path: path.join(output, 'reality-anchor-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await anchor(page).getByRole('button', { name: 'Close Reality Anchor', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene'); check('Mobile anchor fits without page overflow and X restores scene focus');
  const reduced = await makeViewer('/2d?floor=local', true); await open(reduced); await choose(reduced, 'Architecture review');
  assert.equal(await anchor(reduced).getByLabel('Instant transition').isChecked(), true);
  await anchor(reduced).getByRole('button', { name: 'Enter now', exact: true }).click();
  await reduced.waitForFunction(id => window.__office.store.selectedMeetingSpace === id, otherId);
  assert.equal(await reduced.locator('.reality-crossing').count(), 0); check('2D and reduced motion enter without the cinematic sweep');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page); await choose(page, 'Architecture review'); await anchor(page).getByRole('button', { name: 'Enter now', exact: true }).click();
  await page.evaluate(floor => window.__office.net.send({ t: 'floor.go', floor }), ROOF);
  await page.waitForFunction(() => window.__office.store.floor !== 'local');
  await page.waitForTimeout(850);
  assert.equal(await page.locator('.reality-crossing').count(), 0); check('Leaving the floor cancels pending crossings and portal effects');
  assert.deepEqual(errors, []); check('No browser runtime or WebGL shader errors');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2)); console.log('Evidence: ' + output);
} finally { await browser?.close(); await f.close(); }
