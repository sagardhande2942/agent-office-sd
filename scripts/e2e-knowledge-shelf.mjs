import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { KnowledgeStore } from '../src/server/knowledge/store.ts';
import { knowledgeFixture, browserPath } from './support/knowledge-fixture.mjs';
const f = await knowledgeFixture({ reviewPolicy: 'off' }); const artifacts = process.env.KNOWLEDGE_ARTIFACTS ?? '/tmp/agent-office-knowledge-evidence'; fs.mkdirSync(artifacts, { recursive: true });
let browser;
try {
  const store = new KnowledgeStore(f.project); store.write('project/test.md', { title: 'Run the test suite', summary: 'Use npm test to verify changes', status: 'needs-verification', sources: ['PR #123'], tags: ['testing', 'ci'] }, '# Tests\n\nRun `npm test`.\n', 'worker:fixture');
  store.write('gotchas/old.md', { title: 'Old deployment command', summary: 'Retained for history', status: 'archived' }, 'Old command', 'worker:fixture');
  browser = await chromium.launch({ executablePath: browserPath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Knowledge tester', color: '#06d6a0', look: { skin: 0, hair: 0, style: 0 } })); localStorage.setItem('agent-office.lite-declined', '1'); });
  assert.ok((await context.request.post(f.base + '/api/login', { data: { password: 'knowledge-fixture' } })).ok());
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(f.base + '/2d?floor=local'); await page.waitForFunction(() => window.__game2d?.ctx.net.up && window.__game2d.store.floor === 'local' && !window.__game2d.core.trip);
  await page.locator('#loading').waitFor({ state: 'hidden' }); await page.keyboard.press('Tab'); await page.locator('button:has-text("Knowledge base")').first().click();
  const modal = page.getByRole('dialog', { name: 'Knowledge', exact: true }); await modal.waitFor();
  await modal.locator('.knowledge-row').filter({ hasText: 'Run the test suite' }).click(); await modal.locator('h3').filter({ hasText: 'Run the test suite' }).waitFor();
  assert.ok(await modal.locator('.knowledge-badge.needs-verification').count()); assert.ok(await modal.locator('.knowledge-badge.archived').count());
  await modal.getByRole('button', { name: 'Edit', exact: true }).click(); const editor = page.getByRole('dialog', { name: 'Edit knowledge', exact: true });
  await editor.getByLabel('Markdown body').fill('# Tests\n\nRun `npm test` before opening a PR.\n'); await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__game2d.store.knowledge.uncommitted);
  const parsed = (await import('../src/shared/knowledge-index.ts')).parseKnowledgeNote(store.read('project/test.md').text);
  assert.equal(parsed.frontmatter.status, 'needs-verification'); assert.deepEqual(parsed.frontmatter.sources, ['PR #123']);
  await editor.waitFor({ state: 'detached' });
  await modal.locator('.knowledge-row').filter({ hasText: 'Run the test suite' }).click(); await modal.locator('.md').filter({ hasText: 'before opening a PR' }).waitFor();
  await modal.getByRole('button', { name: 'Publish review', exact: true }).waitFor();
  await modal.getByRole('button', { name: 'Sync approved', exact: true }).waitFor();
  await modal.getByRole('button', { name: 'Edit', exact: true }).click(); await editor.waitFor();
  store.write('project/test.md', {}, '# Tests\n\nConcurrent worker update.\n', 'worker:other');
  await editor.getByLabel('Markdown body').fill('Stale edit that must remain recoverable');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Knowledge changed:', { exact: false }).first().waitFor();
  assert.equal(await editor.getByLabel('Markdown body').inputValue(), 'Stale edit that must remain recoverable');
  assert.match(store.read('project/test.md').text, /Concurrent worker update/);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => {
    const s = window.__game2d.store;
    s.knowledge.deliveries = Array.from({ length: 5 }, (_, i) => ({ id: String(i), state: 'failed', error: ('Curator usage limit; retained at /tmp/' + 'long-path'.repeat(30) + '\n').repeat(8) }));
    s.emit('knowledge');
  });
  for (const [width, height] of [[1440, 900], [712, 1162], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const reviews = modal.locator('.knowledge-reviews');
    assert.equal(await reviews.getAttribute('open'), null);
    await reviews.locator('summary').click();
    const layout = await modal.evaluate(el => {
      const box = selector => el.querySelector(selector).getBoundingClientRect();
      const body = el.querySelector('.body');
      const list = el.querySelector('.knowledge-review-list');
      return { width: el.getBoundingClientRect().width, bodyWidth: body.clientWidth, scrollWidth: body.scrollWidth,
        bodyHeight: body.clientHeight, scrollHeight: body.scrollHeight, treeHeight: box('.knowledge-tree').height,
        noteHeight: box('.knowledge-note').height, bottom: box('.knowledge-columns').bottom,
        modalBottom: el.getBoundingClientRect().bottom, logsScroll: list.scrollHeight > list.clientHeight };
    });
    assert.ok(layout.width <= width && layout.bottom <= layout.modalBottom, JSON.stringify(layout));
    assert.ok(layout.scrollWidth <= layout.bodyWidth + 1 && layout.scrollHeight <= layout.bodyHeight + 1, JSON.stringify(layout));
    assert.ok(layout.treeHeight > 60 && layout.noteHeight > 120 && layout.logsScroll, JSON.stringify(layout));
    await page.screenshot({ path: path.join(artifacts, `knowledge-errors-${width}.png`) });
    await reviews.locator('summary').click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(artifacts, 'knowledge-shelf.png') });
  await modal.getByRole('button', { name: 'Close', exact: true }).click(); await modal.waitFor({ state: 'detached' });
  await page.keyboard.press('Tab'); await page.locator('button:has-text("Knowledge base")').first().click(); await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify({ tree: true, statusBadges: true, editPreservesStatus: true, editPreservesSources: true, closeAndEscape: true }, null, 2));
  console.log(`PASS: knowledge shelf; screenshot ${artifacts}/knowledge-shelf.png`);
} finally { await browser?.close(); await f.close(); }
