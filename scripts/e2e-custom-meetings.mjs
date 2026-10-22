// Production client + real Office server, isolated Git project and idle fake agents; no paid calls.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { knowledgeFixture } from './support/knowledge-fixture.mjs';
const output = path.resolve(process.env.CUSTOM_MEETING_ARTIFACTS ?? '/tmp/agent-office-custom-meetings-evidence');
mkdirSync(output, { recursive: true });
const f = await knowledgeFixture();
const errors = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Meeting reviewer', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.lite-declined', '1');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(ts => { const r = window.__office?.renderer; if (r) r.render = () => {}; cb(ts); });
  });
  assert.ok((await context.request.post(f.base + '/api/login', { data: { password: 'knowledge-fixture' } })).ok());
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(f.base + '/?3d=1&floor=local');
  await page.waitForFunction(() => window.__office?.net.up && window.__office.store.floor === 'local' && window.__office.player.enabled);
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.keyboard.press('Tab'); await page.getByRole('menuitem', { name: /Meeting room/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Meeting room', exact: true });
  await dialog.waitFor();
  const choice = dialog.locator('[data-pattern="custom"]');
  await choice.click(); await choice.scrollIntoViewIfNeeded();
  assert.equal(await choice.getAttribute('aria-checked'), 'true');
  const definition = dialog.getByRole('textbox', {name:'Workflow definition',exact:true});
  await definition.waitFor();
  const workflow = JSON.parse(await definition.inputValue()); workflow.id='docs.review'; workflow.label='Document review'; workflow.roles=['Editor','Reviewer'];
  await definition.fill(JSON.stringify(workflow,null,2)); await definition.dispatchEvent('change');
  await dialog.getByText('2 rounds · fixed by the Document review workflow',{exact:false}).waitFor();
  await dialog.getByText('Requires JSON matching the workflow rules', {exact:false}).waitFor();
  checks.push('A generic caller-defined workflow is selectable without starting agents');
  assert.equal(f.floor.workers.list().length, 0);
  await dialog.locator('[data-pattern="custom"]').click();
  await page.screenshot({ path: path.join(output, 'custom-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator('[data-pattern="custom"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'custom-mobile.png'), fullPage: true });
  await definition.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'custom-mobile-definition.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.enabled);
  await page.keyboard.press('Tab'); await page.getByRole('menuitem',{name:/Meeting room/}).click();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.waitForFunction(()=>window.__office.player.enabled);
  checks.push('Desktop/mobile custom definition, Escape and close restore player control');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('Tab'); await page.getByRole('menuitem', { name: /Meeting room/ }).click();
  await dialog.locator('[data-pattern="custom"]').click();
  await definition.fill(JSON.stringify(workflow,null,2)); await definition.dispatchEvent('change');
  await dialog.locator('textarea').first().fill('Review the provided document and report missing references explicitly.');
  await dialog.getByRole('button', { name: /Start the meeting/ }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current?.status === 'running');
  const meeting = f.floor.meetings.state().current;
  assert.deepEqual(meeting.workflow,workflow);
  const participants = f.floor.workers.list().filter(w => w.meeting === meeting.id);
  assert.equal(participants.length, 2);
  assert.ok(participants.every(w => w.prompt.includes('MEETING SHARED MEMORY')));
  const saved = JSON.parse(readFileSync(path.join(f.project, '.agent-office/workers.json'), 'utf8'));
  const call = async (id, body) => {
    const token = saved.find(w => w.id === id).hookToken;
    return fetch(`http://127.0.0.1:${f.office.hookPort}/office/workers/knowledge?worker=${id}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  };
  assert.equal((await call(meeting.seats[1].workerId, { action: 'index' })).status, 200);
  const observation = { action: 'write', path: `meetings/observations/${meeting.id}/finding.md`,
    frontmatter: { title: 'Fixture observation', summary: 'Synthetic evidence only', status: 'active' }, body: 'Synthetic document observation only.' };
  assert.equal((await call(meeting.seats[1].workerId, observation)).status, 400);
  const written = await call(meeting.seats[0].workerId, observation);
  assert.equal(written.status, 200);
  assert.equal((await written.json()).frontmatter.status, 'needs-verification');
  checks.push('Real room participants receive shared context; authenticated peer reads and chair-only unverified writes work');
  await page.screenshot({ path: path.join(output, 'custom-memory-running.png'), fullPage: true });

  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks }));
} finally { await browser?.close(); await f.close(); }
