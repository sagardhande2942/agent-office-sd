// npm run build && node --import tsx scripts/e2e-meeting-spaces.mjs
// Real server, worktrees and idle fixture agents; no model calls.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { knowledgeFixture, browserPath } from './support/knowledge-fixture.mjs';
const output = path.resolve(process.env.MEETING_SPACES_ARTIFACTS ?? '/tmp/agent-office-meeting-spaces-evidence');
mkdirSync(output, { recursive: true });
const f = await knowledgeFixture();
const checks = [], errors = [], screenshots = [];
const check = name => { checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
let browser, page;
try {
  browser = await chromium.launch({ executablePath: browserPath(), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const makeViewer = async name => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(name => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name, color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
      localStorage.setItem('agent-office.lite-declined', '1');
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(ts => { const r = window.__office?.renderer; if (r) r.render = () => {}; cb(ts); });
    }, name);
    assert.ok((await context.request.post(f.base + '/api/login', { data: { password: 'knowledge-fixture' } })).ok());
    const p = await context.newPage(); p.setDefaultTimeout(15000); p.on('pageerror', e => errors.push(e.message));
    return p;
  };
  const arrive = async (p, route = '/?3d=1&floor=local') => {
    await p.goto(f.base + route);
    await p.waitForFunction(() => window.__office?.net.up && window.__office.store.floor === 'local' && window.__office.player.enabled);
    await p.waitForSelector('#loading', { state: 'hidden' });
  };
  const dialog = p => p.getByRole('dialog', { name: 'Meeting room', exact: true });
  const open = async p => { await p.keyboard.press('Tab'); await p.getByRole('menuitem', { name: /Meeting room/ }).click(); await dialog(p).waitFor(); };
  const shot = async name => { await page.screenshot({ path: path.join(output, name) }); screenshots.push(name); };
  const start = async title => {
    await dialog(page).getByLabel('What the meeting is about').fill(`Explore ${title} independently`);
    await dialog(page).getByLabel('Title', { exact: true }).fill(title);
    await dialog(page).getByRole('button', { name: /Start the meeting/ }).click();
    await page.waitForFunction(title => window.__office.store.meeting.current?.title === title, title);
    await open(page);
  };
  page = await makeViewer('Space explorer'); await arrive(page); await open(page);
  assert.equal(f.floor.workers.list().length, 0);
  await dialog(page).getByRole('button', { name: '+ New space', exact: true }).click();
  await dialog(page).getByLabel('Space name').fill('Product planning');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__office.store.selectedMeetingSpace !== 'main');
  const productId = await dialog(page).getByLabel('Meeting space', { exact: true }).inputValue();
  assert.equal(f.floor.workers.list().length, 0); check('Creating a persistent named space hires no agents');
  await start('Product roadmap'); const product = f.floor.meetings.state().spaces.find(s => s.id === productId).current;
  await dialog(page).getByLabel('Meeting space', { exact: true }).selectOption('main');
  await start('Bug investigation'); const main = f.floor.meetings.state().current;
  assert.equal(f.floor.workers.list().length, 6);
  assert.notEqual(product.worktree.path, main.worktree.path);
  assert.equal(f.floor.meetings.state().spaces.filter(s => s.current?.status === 'running').length, 2);
  await page.waitForFunction(() => [...window.__office.workerViews.keys()].every(id => window.__office.store.workers.get(id)?.meeting === window.__office.store.meeting.current.id));
  await shot('main-space.png'); check('Two real meetings share physical chairs but run in independent worktrees; only selected agents are drawn');
  const other = await makeViewer('Other viewer'); await arrive(other); await open(other);
  await dialog(page).getByLabel('Meeting space', { exact: true }).selectOption(productId);
  assert.equal(await dialog(other).getByLabel('Meeting space', { exact: true }).inputValue(), 'main');
  const background = f.floor.workers.list().find(w => w.meeting === main.id);
  const savedWorkers = JSON.parse(readFileSync(path.join(f.project, '.agent-office/workers.json'), 'utf8'));
  for (const worker of f.floor.workers.list().filter(w => w.meeting === main.id)) {
    const key = savedWorkers.find(w => w.id === worker.id).hookToken;
    assert.equal(f.floor.workers.handleHook(worker.id, key, 'SessionStart', {}), true);
  }
  const token = savedWorkers.find(w => w.id === background.id).hookToken;
  assert.equal(f.floor.workers.handleHook(background.id, token, 'PermissionRequest', { tool_name: 'Read', tool_input: { file_path: 'README.md' } }), true);
  await dialog(page).getByText('1 other space needs attention', { exact: true }).waitFor();
  check('Background input requests appear as attention badges without changing the selected meeting');

  await page.waitForFunction(id => window.__office.store.meeting.current?.id === id, product.id);
  await shot('product-space.png'); check('Switching changes the local room projection without moving another viewer or stopping background work');
  await page.reload(); await page.waitForFunction(id => window.__office?.store.selectedMeetingSpace === id, productId); await page.waitForSelector('#loading', { state: 'hidden' }); await open(page);
  assert.equal(await dialog(page).getByLabel('Meeting space', { exact: true }).inputValue(), productId); check('Selected space persists through reload and reconnection');
  await dialog(page).getByRole('button', { name: 'Rename', exact: true }).click();
  await dialog(page).getByLabel('Space name').fill('Release planning'); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__office.store.meetingSpaces.spaces.some(s => s.name === 'Release planning'));
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await dialog(page).getByLabel('Meeting space', { exact: true }).isVisible());
  check('Space selector and rename work on mobile without page overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog(page).getByRole('button', { name: /Stop meeting/ }).click();
  await page.getByRole('button', { name: 'Stop it', exact: true }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current?.status === 'stopped');
  assert.equal(f.floor.meetings.state().current.status, 'running');
  await dialog(page).getByRole('button', { name: /Clear the room/ }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current === null);
  assert.equal(f.floor.meetings.state().current.status, 'running');
  assert.equal(f.floor.workers.list().length, 3); check('Stop and clear affect only the selected space, preserving the other meeting and agents');
  assert.equal(f.floor.workers.handleHook(background.id, token, 'UserPromptSubmit', {}), true);
  await page.waitForFunction(() => document.querySelector('.meeting-space-attention')?.textContent === '');
  assert.equal(f.floor.workers.handleHook(background.id, token, 'PermissionRequest', { tool_name: 'Read', tool_input: { file_path: 'README.md' } }), true);
  await dialog(page).getByText('1 other space needs attention', { exact: true }).waitFor();
  check('Attention updates while an empty space shows its meeting form');
  for (const [view, route] of [['3d', '/?3d=1&floor=local'], ['2d', '/2d?floor=local']]) {
    if (view === '2d') { await page.keyboard.press('Escape'); await arrive(page, route); await open(page); }
    await shot(view + '.png'); await page.keyboard.press('Escape');
    const restored = view => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene' && window.__office.player.enabled && (view === '2d' ? !window.__office.player.mouseLook : window.__office.player.hasMouse);
    await page.waitForFunction(restored, view); await open(page); await dialog(page).getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForFunction(restored, view);
    check(view + ' Esc/X restores scene focus and controls immediately');
  }
  assert.deepEqual(errors, []); check('No browser runtime errors');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, failure: String(error) }, null, 2)); throw error;
} finally {
  await browser?.close(); await f.close();
}
console.log(`Evidence: ${output}`); process.exit(0);
