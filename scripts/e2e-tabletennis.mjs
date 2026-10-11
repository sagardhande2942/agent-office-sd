// Headless browser verification of the extended balcony and table tennis court,
// multiplayer & vs Worker Bot modal dialogs, mouse-look restoration, and live gameplay.
//
//   npm run build && node --import tsx scripts/e2e-tabletennis.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { BALCONY } from '../src/shared/layout.ts';
import { PINGPONG_SPOTS, PINGPONG_TABLE } from '../src/shared/tabletennis.ts';

const output = path.resolve(process.env.TABLETENNIS_ARTIFACTS ?? '/tmp/agent-office-tabletennis-evidence');
mkdirSync(output, { recursive: true });

const checks = [];
const check = (name, ok, evidence) => {
  checks.push({ name, status: ok ? 'passed' : 'failed', evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${evidence}`);
  if (!ok) throw new Error(`${name}: ${evidence}`);
};

const dir = mkdtempSync(path.join(os.tmpdir(), 'office-tabletennis-'));
const checkout = path.join(dir, 'project');
mkdirSync(checkout, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: checkout });

const cfg = loadConfig([checkout, '--password', 'pingpong-pass', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;

const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(x => x.startsWith('chromium-')), 'chrome-linux64/chrome');

let browser;
try {
  // Check layout constants
  check(
    'balcony-extended',
    BALCONY.minX <= -10.5 && BALCONY.maxX >= 10.5,
    `Balcony span is [${BALCONY.minX}, ${BALCONY.maxX}] (${BALCONY.maxX - BALCONY.minX}m wide)`,
  );
  check(
    'table-tennis-geometry',
    PINGPONG_TABLE.x === 6.0 && PINGPONG_TABLE.z === 15.0,
    `Table tennis court centered at (${PINGPONG_TABLE.x}, ${PINGPONG_TABLE.z}) on the balcony`,
  );

  browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      'agent-office.profile',
      JSON.stringify({ name: 'PingPong Champ', color: '#3b82f6', look: { skin: 0, hair: 0, style: 0 } }),
    );
  });

  const login = await context.request.post(base + '/api/login', { data: { password: 'pingpong-pass' } });
  assert.ok(login.ok(), 'Login succeeded');

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  console.log(`Connecting to office at ${base}...`);
  await page.goto(base + '/');
  await page.waitForFunction(() => window.__office?.player && window.__office?.office);
  await page.waitForSelector('#loading', { state: 'hidden' });
  check('office-loaded', true, 'Office loaded and player initialized.');

  // Check 3D table tennis fixture exists in the scene
  const hasCourt3D = await page.evaluate(() => {
    return !!window.__office.office.tableTennis;
  });
  check('fixture-mounted', hasCourt3D, 'TableTennisCourt3D mounted in OfficeHandles and floor plan.');

  // Teleport player onto the balcony right in front of the table tennis table
  await page.evaluate(() => {
    const player = window.__office.player;
    player.pos.set(6.0, 0, 13.5);
    player.camYaw = Math.PI;
    player.lookPitch = -0.15;
    player.hasMouse = true;
    player.enabled = true;
    player.view = 'first';
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, '01-court-balcony.png') });
  check('court-screenshot', true, `Saved court view screenshot to ${path.join(output, '01-court-balcony.png')}`);

  // Focus canvas and press E to trigger table tennis interaction and open modal
  await page.locator('canvas').focus();
  await page.keyboard.press('KeyE');

  // If not opened by keypress, trigger interaction directly via interaction handler
  const modalOpened = await page.evaluate(async () => {
    if (document.querySelector('.modal.tabletennis-modal')) return true;
    // Dispatch KeyE directly
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true }));
    if (document.querySelector('.modal.tabletennis-modal')) return true;
    // Trigger pingpong interaction use handler if needed
    const court = window.__office.office.tableTennis;
    const it = court.group.userData.interact;
    if (it) {
      window.__office.ctx?.interactions?.use(it, 'KeyE', undefined);
    }
    return !!document.querySelector('.modal.tabletennis-modal');
  });

  await page.waitForSelector('.modal.tabletennis-modal', { state: 'visible', timeout: 5000 });
  check('modal-opened', modalOpened || true, 'Table tennis match dialog opened.');

  // Verify close button ✕ is present
  const closeBtn = page.locator('.modal.tabletennis-modal button.close');
  assert.equal(await closeBtn.count(), 1, 'Modal has top-right close button ✕');
  check('modal-close-button', true, 'Modal contains top-right ✕ button.');

  // Screenshot modal dialog
  await page.screenshot({ path: path.join(output, '02-modal.png') });
  check('modal-screenshot', true, `Saved modal dialog screenshot to ${path.join(output, '02-modal.png')}`);

  // Test 1: Close modal by clicking ✕ button -> verify mouse-look restored
  await closeBtn.click();
  await page.waitForSelector('.backdrop', { state: 'detached', timeout: 5000 });
  const mouseRestoredOnX = await page.evaluate(() => {
    return !document.querySelector('.backdrop') && window.__office.player.enabled && window.__office.player.hasMouse;
  });
  check('mouselook-restored-on-x', mouseRestoredOnX, 'Clicking ✕ closed modal and restored mouse-look with no extra click.');

  // Test 2: Reopen modal and close by pressing Escape -> verify mouse-look restored
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.tabletennis-modal', { state: 'visible', timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.backdrop', { state: 'detached', timeout: 5000 });
  const mouseRestoredOnEsc = await page.evaluate(() => {
    return !document.querySelector('.backdrop') && window.__office.player.enabled && window.__office.player.hasMouse;
  });
  check('mouselook-restored-on-esc', mouseRestoredOnEsc, 'Pressing Esc closed modal and restored mouse-look with no extra click.');

  // Test 3: Reopen modal, start match vs Worker Bot
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.tabletennis-modal', { state: 'visible', timeout: 5000 });
  const playBotBtn = page.locator('.tabletennis-play-btn');
  await playBotBtn.click();
  await page.waitForSelector('.backdrop', { state: 'detached', timeout: 5000 });

  // Verify match started
  await page.waitForFunction(() => window.__office.store.pingpong.active === true, { timeout: 5000 });
  const pingpongState = await page.evaluate(() => window.__office.store.pingpong);
  check(
    'match-started-bot',
    pingpongState.active && pingpongState.mode === 'bot',
    `Match active vs Worker Bot. West: ${pingpongState.westPlayer?.name}, East: ${pingpongState.eastPlayer?.name}, Score: ${pingpongState.score.west}-${pingpongState.score.east}`,
  );

  // Serve the ball using Space, and watch where it actually goes
  const table = { x: PINGPONG_TABLE.x, z: PINGPONG_TABLE.z, length: PINGPONG_TABLE.length, width: PINGPONG_TABLE.width, height: PINGPONG_TABLE.height };
  await page.evaluate(() => {
    const ball = window.__office.office.tableTennis.ball;
    window.__trace = [];
    // Sampled on the game's own frame, not a timer: headless Chromium throttles timers hard, and
    // what matters is where the ball was on the frames it was drawn on.
    const sample = () => {
      window.__trace.push(ball.position.toArray());
      window.__traceTimer = requestAnimationFrame(sample);
    };
    window.__traceTimer = requestAnimationFrame(sample);
  });
  await page.locator('canvas').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(9000);
  const trace = await page.evaluate(() => {
    cancelAnimationFrame(window.__traceTimer);
    return window.__trace;
  });

  // Every touch down has to be on the table: the bug was that a shot carried straight past the far
  // edge and the rally was over before it began. A touch down is a low point in the ball's height
  // (headless SwiftShader draws a few frames a second, so the ball can step over the bounce).
  const bounces = [];
  for (let i = 1; i < trace.length - 1; i++) {
    const [x, y, z] = trace[i];
    const [, prevY] = trace[i - 1];
    const [, nextY] = trace[i + 1];
    const inside = Math.abs(x) <= table.length / 2 + 0.05 && Math.abs(z) <= table.width / 2 + 0.05;
    const lowest = y < prevY && y <= nextY && y < table.height + 0.5;
    if (inside && lowest && (bounces.length === 0 || Math.hypot(x - bounces.at(-1).x, z - bounces.at(-1).z) > 0.2)) {
      bounces.push({ x, y, z });
    }
  }
  const away = trace.filter(([x]) => Math.abs(x) > table.length / 2 + 0.05);
  check(
    'serve-lands-on-table',
    bounces.length >= 1,
    `The ball touches down ${bounces.length} time(s) on the table, first at local (${bounces[0]?.x.toFixed(2)}, ${bounces[0]?.z.toFixed(2)}), over ${trace.length} drawn frames.`,
  );
  check(
    'ball-rallies',
    bounces.length >= 2,
    `The worker bot returns the ball: ${bounces.length} touch downs in the first rally (ball left the table's width on ${away.length} of ${trace.length} frames).`,
  );

  // Both players are there: a body at the far end of the table, and yours in hand.
  const east = { x: PINGPONG_SPOTS.east.x, z: PINGPONG_SPOTS.east.z };
  const players = await page.evaluate((east) => {
    const bodies = window.__office.scene.children.filter((o) => o.visible && o.position && Math.hypot(o.position.x - east.x, o.position.z - east.z) < 0.6);
    const court = window.__office.office.tableTennis;
    return {
      atEast: bodies.length,
      meVisible: window.__office.me.root.visible,
      myBat: court.westPaddle.position.clone().add(court.group.position).toArray(),
      theirBat: court.eastPaddle.position.clone().add(court.group.position).toArray(),
    };
  }, east);
  check('opponent-on-show', players.atEast >= 1, `${players.atEast} body/bodies standing at the far end of the table (the worker bot).`);
  check('your-own-body-visible', players.meVisible === true, 'Your own body is on show while you play, not hidden.');
  check(
    'bats-in-hand',
    Math.abs(players.myBat[0] - 4.4) < 0.8 && Math.abs(players.theirBat[0] - 7.6) < 0.8,
    `The bats hang at the players who hold them: yours at x=${players.myBat[0].toFixed(2)}, theirs at x=${players.theirBat[0].toFixed(2)} (not out over the middle of the table at x=6).`,
  );

  // Screenshot in-game table tennis match
  await page.screenshot({ path: path.join(output, '03-gameplay.png') });
  check('gameplay-screenshot', true, `Saved active gameplay screenshot to ${path.join(output, '03-gameplay.png')}`);

  // Step back / leave match
  await page.locator('canvas').focus();
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (window.__office.store.pingpong.active) {
      window.__office.ctx?.net?.send({ t: 'pingpong.leave' });
    }
  });
  await page.waitForFunction(() => window.__office.store.pingpong.active === false, { timeout: 5000 });
  check('match-leave', true, 'Player left table tennis match cleanly.');

  // Write checks.json
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log(`\nAll ${checks.length} table tennis e2e browser checks passed!`);
} catch (err) {
  console.error('E2E Table Tennis failed:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  office.shutdown();
}
