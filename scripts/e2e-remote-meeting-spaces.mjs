// npm run build && node --import tsx scripts/e2e-remote-meeting-spaces.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserPath } from './support/knowledge-fixture.mjs';
import { remoteMeetingFixture } from './support/remote-meeting-fixture.mjs';
const output = path.resolve(process.env.MEETING_SPACES_ARTIFACTS ?? '/tmp/agent-office-remote-meeting-spaces-evidence');
mkdirSync(output, { recursive: true });
const f = await remoteMeetingFixture(), checks = [], errors = [];
const check = name => { checks.push(name); console.log('PASS ' + name); };
let browser;
try {
  browser = await chromium.launch({ executablePath: browserPath(), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const makeViewer = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem('agent-office.lite-declined', '1');
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Meeting viewer', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(ts => { const r = window.__office?.renderer; if (r) r.render = () => {}; cb(ts); });
    });
    assert.ok((await context.request.post(f.base + '/api/login', { data: { password: 'remote-meetings' } })).ok());
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(f.base + '/2d?floor=remote-meetings');
    try { await page.waitForFunction(() => window.__office?.store.floor === 'remote-meetings' && window.__office.store.meetingSpaces.spaces?.length > 0 && window.__office.player.enabled); }
    catch (e) { console.log(await page.evaluate(() => ({ text: document.body.innerText.slice(-4000), floor: window.__office?.store.floor, spaces: window.__office?.store.meetingSpaces, enabled: window.__office?.player.enabled }))); console.log(errors); throw e; }
    await page.waitForSelector('#loading', { state: 'hidden' });
    return page;
  };
  const page = await makeViewer();
  const dialog = p => p.getByRole('dialog', { name: 'Meeting room', exact: true });
  const switchSpace = async (p, id) => { const select = dialog(p).getByLabel('Meeting space', { exact: true }); if (!await select.isVisible()) await dialog(p).getByText('Instant switch', { exact: true }).click(); await select.selectOption(id); };
  const open = async p => { await p.keyboard.press('Tab'); await p.getByRole('menuitem', { name: /Meeting room/ }).click(); await dialog(p).waitFor(); };
  const create = async name => {
    await dialog(page).getByRole('button', { name: '+ New space', exact: true }).click();
    await dialog(page).getByLabel('Space name').fill(name); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(name => window.__office.store.meetingSpaces.spaces.some(s => s.name === name && s.id === window.__office.store.selectedMeetingSpace), name);
    return dialog(page).getByLabel('Meeting space', { exact: true }).inputValue();
  };
  const start = async (spaceId, title) => {
    assert.equal(await dialog(page).getByLabel('Meeting space', { exact: true }).inputValue(), spaceId);
    await dialog(page).getByLabel('What the meeting is about').fill('Compare cache designs');
    await dialog(page).getByLabel('Title', { exact: true }).fill(title);
    await dialog(page).getByRole('button', { name: 'Fewer workers', exact: true }).click();
    await dialog(page).getByLabel('Round limit').selectOption('2');
    await dialog(page).getByRole('button', { name: /Start the meeting/ }).click();
    await page.waitForFunction(title => window.__office.store.meetingSpaces.spaces.some(s => s.current?.title === title), title);
    await open(page);
  };
  await open(page);
  const productId = await create('Remote product');
  assert.equal(f.floor.workers.list().length, 0); check('Remote space creation persists on the host without hiring agents');
  await start(productId, 'Product cache');
  await switchSpace(page, 'main');
  await start('main', 'Bug cache');
  const spaces = f.floor.meetings.state().spaces, product = spaces.find(s => s.id === productId).current, main = spaces[0].current;
  assert.equal(f.floor.workers.list().length, 4); assert.notEqual(product.worktree.path, main.worktree.path);
  assert.ok(existsSync(path.join(f.project, product.worktree.path))); assert.equal(f.office.floors().length, 0);
  assert.equal(f.floor.workers.list().every(w => w.meeting === main.id || w.meeting === product.id), true);
  check('Two hosted meetings run on separate host worktrees and shared physical chairs; office opens no checkout');
  const other = await makeViewer(); await open(other);
  await switchSpace(page, productId);
  assert.equal(await dialog(other).getByLabel('Meeting space', { exact: true }).inputValue(), 'main');
  check('Remote space selection belongs to each viewer');
  const thirdId = await create('Over capacity');
  await page.evaluate(spaceId => window.__office.net.send({ t: 'meeting.start', spaceId, pattern: 'debate', prompt: 'Should be refused', roles: ['Chair', 'Skeptic'] }), thirdId);
  await page.locator('.toast').filter({ hasText: 'configured seat limit' }).waitFor();
  assert.equal(f.floor.meetings.state().spaces.find(s => s.id === thirdId).current, null);
  assert.equal(f.floor.workers.list().length, 4); check('Host seat limits refuse a whole meeting without orphan agents');
  const [a, b] = main.seats.map(s => s.workerId);
  assert.equal((await f.tool(a, '/inbox', undefined, true)).status, 401);
  assert.equal((await f.tool(a, '')).status, 200);
  const request = await f.tool(a, '/request', { worker: b, key: 'cache-question', prompt: 'Confirm cache invalidation' });
  assert.equal(request.status, 200, JSON.stringify(request.body));
  assert.equal(request.body.message.meeting.id, main.id);
  await page.waitForFunction(id => window.__office.store.communications.messages.some(m => m.id === id), request.body.message.id);
  check('Authenticated host inbox links requests to the correct meeting and streams them to viewers');
  for (const meeting of [main]) {
    for (const turn of meeting.turns) {
      const file = path.join(f.project, meeting.worktree.path, turn.file); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, '# Cache proposal');
    }
    const saved = JSON.parse(readFileSync(path.join(f.project, '.agent-office/workers.json'), 'utf8'));
    for (const seat of meeting.seats) {
      const token = saved.find(w => w.id === seat.workerId).hookToken;
      assert.equal(f.floor.workers.handleHook(seat.workerId, token, 'UserPromptSubmit', {}), true);
      assert.equal(f.floor.workers.handleHook(seat.workerId, token, 'Stop', {}), true);
    }
    await f.wait(() => f.floor.meetings.state().current.round === 2);
    const outputFile = path.join(f.project, meeting.worktree.path, meeting.output);
    mkdirSync(path.dirname(outputFile), { recursive: true }); writeFileSync(outputFile, '# Cache decision');
    const token = saved.find(w => w.id === a).hookToken;
    f.floor.workers.handleHook(a, token, 'UserPromptSubmit', {}); f.floor.workers.handleHook(a, token, 'Stop', {});
    await f.wait(() => f.floor.meetings.state().current.waitingForCommunications);
  }
  assert.equal(f.floor.meetings.state().current.status, 'running');
  await page.waitForFunction(() => window.__office.store.meetingSpaces.spaces[0].current.waitingForCommunications);
  check('Host meeting completion waits for unresolved requests using the same persistent inbox');
  await switchSpace(page, 'main');
  await dialog(page).getByRole('button', { name: 'Finish anyway', exact: true }).click();
  await page.getByRole('button', { name: 'Finish anyway', exact: true }).last().click();
  await page.waitForFunction(() => window.__office.store.meeting.current.status === 'done');
  assert.equal(f.floor.meetings.state().spaces.find(s => s.id === productId).current.status, 'running');
  await page.screenshot({ path: path.join(output, 'remote-meeting-completed.png') });
  check('Finish override is routed to its meeting and leaves the other remote meeting running');
  await switchSpace(page, productId);
  await dialog(page).getByRole('button', { name: 'Rename', exact: true }).click(); await dialog(page).getByLabel('Space name').fill('Remote release'); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(id => window.__office.store.meetingSpaces.spaces.find(s => s.id === id)?.name === 'Remote release', productId);
  await page.screenshot({ path: path.join(output, 'remote-meeting-spaces.png') });
  await f.restartHost();
  await page.reload();
  await page.waitForFunction(id => window.__office?.store.selectedMeetingSpace === id && window.__office.store.meetingSpaces.spaces.find(s => s.id === id)?.name === 'Remote release', productId);
  await page.waitForSelector('#loading', { state: 'hidden' }); await open(page);
  assert.equal(f.floor.meetings.state().spaces.find(s => s.id === productId).current.id, product.id);
  check('Host restart and browser reload restore named spaces, meetings, and viewer selection');
  await dialog(page).getByRole('button', { name: /Stop meeting/ }).click(); await page.getByRole('button', { name: 'Stop it', exact: true }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current.status === 'stopped');
  await dialog(page).getByRole('button', { name: /Clear the room/ }).click();
  await page.waitForFunction(() => window.__office.store.meeting.current === null);
  assert.equal(f.floor.meetings.state().current.id, main.id); assert.equal(f.floor.meetings.state().current.status, 'done');
  await f.wait(() => f.floor.workers.list().length === 2);
  check('Remote stop and clear stay scoped across reconnects');
  assert.deepEqual(errors, []); check('No browser runtime errors');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2)); console.log('Evidence: ' + output);
} finally { await browser?.close(); await f.close(); }
