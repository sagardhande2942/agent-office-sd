// Production client + real Office server, isolated Git project and idle fake agents; no paid calls.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { knowledgeFixture } from './support/knowledge-fixture.mjs';
const output = path.resolve(process.env.RESEARCH_PATTERN_ARTIFACTS ?? '/tmp/agent-office-research-patterns-evidence');
mkdirSync(output, { recursive: true });
const f = await knowledgeFixture();
const errors = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Research reviewer', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
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
  for (const id of ['edge-discovery', 'experiment-design', 'strategy-build', 'test-analysis', 'validation-council', 'portfolio-review', 'retrospective']) {
    const choice = dialog.locator(`[data-pattern="research.${id}"]`);
    await choice.click(); await choice.scrollIntoViewIfNeeded();
    assert.equal(await choice.getAttribute('aria-checked'), 'true');
    await dialog.getByText('Recommendations do not approve strategies or submit jobs.', { exact: false }).waitFor();
  }
  checks.push('All seven research patterns can be selected without starting agents');
  assert.equal(f.floor.workers.list().length, 0);
  await dialog.locator('[data-pattern="research.validation-council"]').click();
  await page.screenshot({ path: path.join(output, 'research-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator('[data-pattern="research.validation-council"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'research-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.enabled);
  checks.push('Desktop/mobile selection and Escape restore player control');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('Tab'); await page.getByRole('menuitem', { name: /Meeting room/ }).click();
  await dialog.locator('[data-pattern="research.validation-council"]').click();
  await dialog.locator('textarea').first().fill('Review the provided breakout evidence; report missing inputs explicitly.');
  await dialog.getByRole('button', { name: /Start the meeting/ }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current?.status === 'running');
  const meeting = f.floor.meetings.state().current;
  const participants = f.floor.workers.list().filter(w => w.meeting === meeting.id);
  assert.equal(participants.length, 3);
  assert.ok(participants.every(w => w.prompt.includes('RESEARCH SHARED MEMORY')));
  const saved = JSON.parse(readFileSync(path.join(f.project, '.agent-office/workers.json'), 'utf8'));
  const call = async (id, body) => {
    const token = saved.find(w => w.id === id).hookToken;
    return fetch(`http://127.0.0.1:${f.office.hookPort}/office/workers/knowledge?worker=${id}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  };
  assert.equal((await call(meeting.seats[1].workerId, { action: 'index' })).status, 200);
  const observation = { action: 'write', path: `research/observations/${meeting.id}/finding.md`,
    frontmatter: { title: 'Fixture observation', summary: 'Synthetic evidence only', status: 'active' }, body: 'No actual market result is claimed.' };
  assert.equal((await call(meeting.seats[1].workerId, observation)).status, 400);
  const written = await call(meeting.seats[0].workerId, observation);
  assert.equal(written.status, 200);
  assert.equal((await written.json()).frontmatter.status, 'needs-verification');
  checks.push('Real room participants receive shared context; authenticated peer reads and chair-only unverified writes work');
  await page.screenshot({ path: path.join(output, 'research-memory-running.png'), fullPage: true });

  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks }));
} finally { await browser?.close(); await f.close(); }
