// npm run build && node --import tsx scripts/e2e-conflicts.mjs
// The PR board says a pull request conflicts without anything being opened, and the window's fix
// button names the other open pull requests on the same files.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const output = path.resolve(process.env.CONFLICT_ARTIFACTS ?? '/tmp/agent-office-conflict-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-conflict-'));
const binary = path.join(dir, 'claude');
writeFileSync(binary, `#!${process.execPath}\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
const cfg = loadConfig([dir, '--password', 'conflict-browser', '--no-open', '--agent', binary]);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find((x) => x.startsWith('chromium-')), 'chrome-linux64/chrome');

/** Two workers' open pull requests, both on src/shared/manager.ts: one GitHub says conflicts. */
const pull = (number, title, headRefName, mergeable, mergeStateStatus) => ({
  number, title, state: 'OPEN', isDraft: false, url: `https://github.com/o/r/pull/${number}`, author: 'ada', labels: [],
  reviewDecision: '', headRefName, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 4, deletions: 1,
  checks: 'pass', body: '', closes: [], mergeable, mergeStateStatus,
});
const worker = (id, pr, files) => ({
  id, deskId: `desk-${id === 'mochi' ? 1 : 2}`, name: id, color: '#fff', kind: 'agent', status: 'working',
  createdAt: 1, pr: { number: pr, url: `https://github.com/o/r/pull/${pr}` },
  completion: { revision: 1, summary: 'did it', checks: [], files, submittedAt: 1, status: 'ready' },
});
const floor = {
  floor: 'f1',
  project: { name: 'f1', dir: dir, agentCmd: binary, defaultProvider: 'claude', agentProviders: ['claude'] },
  workers: [worker('mochi', 4, ['src/shared/manager.ts']), worker('byte', 5, ['src/shared/manager.ts'])],
  issues: { items: [], fetchedAt: 1, loading: false },
  pulls: { items: [pull(4, 'Tidy the manager', 'office/mochi', 'CONFLICTING', 'DIRTY'), pull(5, 'Another change', 'office/byte', 'MERGEABLE', 'CLEAN')], fetchedAt: 1, loading: false },
  queue: { tasks: [], maxWorkers: 2 },
  decor: [], plan: { labels: {}, wing: 1 },
};

const errors = [];
let browser, page;
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { const r = window.__office?.renderer; if (r) r.render = () => {}; cb(t); });
  });
  await context.addInitScript(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } })));
  const login = await context.request.post(base + '/api/login', { data: { password: 'conflict-browser' } });
  assert.ok(login.ok(), 'signed in');
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.waitForFunction(() => window.__office?.player);

    await page.keyboard.press('Tab');
  await page.getByRole('menuitem', { name: /Pull requests/ }).click();
  const board = page.getByRole('dialog', { name: 'Pull requests board' });
  await board.waitFor();
  // The fixture project's own `gh` has no repository to answer with, and that answer arrives after
  // this script's own; take the board over once it has said so, with two workers' pull requests.
  await page.evaluate((f) => {
    const { store } = window.__office;
    store.workers.clear();
    for (const w of f.workers) store.workers.set(w.id, w);
    store.apply({ t: 'gh.pulls', state: { ...f.pulls, forge: 'github' } });
    store.apply({ t: 'gh.issues', state: { items: [], fetchedAt: 1, loading: false, forge: 'github' } });
  }, floor);

  // The conflicting one is flagged on its card, and the clean one is not.
  const cards = board.locator('.card');
  assert.equal(await cards.count(), 2, 'both open pull requests are on the board');
  const mochi = cards.filter({ hasText: 'Tidy the manager' });
  const byte = cards.filter({ hasText: 'Another change' });
  await mochi.getByText('⚠️ conflicts', { exact: true }).waitFor();
  assert.equal(await byte.getByText('⚠️ conflicts', { exact: true }).count(), 0, 'a pull request that can merge is not flagged');
  await page.screenshot({ path: path.join(output, 'pr-board-conflicting.png') });
  console.log('PASS the board card shows ⚠️ conflicts, and only on the one that conflicts');

  // Opening it, the fix button says who else is landing on the same files. The window fetches the
  // pull request's detail from the server's `gh`, which this fixture project has no repository for;
  // answer that one request with the same merge state the board is showing.
  await context.route((url) => url.pathname === '/api/gh/pull' && url.searchParams.get('number') === '4', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        number: 4, body: 'Fix the manager', state: 'OPEN', isDraft: false, reviewDecision: '', headRefName: 'office/mochi',
        baseRefName: 'main', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', commits: 2,
        comments: [], reviews: [], reviewComments: [], checks: [],
        repo: { nameWithOwner: 'o/r', methods: ['squash', 'merge', 'rebase'], forge: 'github' }, forge: 'github', viewer: 'ada',
      }),
    }),
  );
  await mochi.click();
  const win = page.getByRole('dialog', { name: 'Pull request #4' });
  await win.waitFor();
  const others = win.locator('.gh-others');
  await others.waitFor();
  assert.match(await others.innerText(), /PR #5 from byte \(src\/shared\/manager\.ts\)/, 'the window names the other pull request and the shared file');
  await page.waitForTimeout(500); // the window fades in; a shot mid-fade overlays the board
  await page.screenshot({ path: path.join(output, 'pr-window-others.png') });
  console.log('PASS the PR window names the other open pull requests on the same files');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('PASS no page errors');
} finally {
  await browser?.close();
  await office.shutdown();
  rmSync(dir, { recursive: true, force: true });
}
console.log('Artifacts: ' + output);