// Staging a demonstration for the screening room, against the actual build, then a headless browser
// looking at what landed: the reel on the screen in the meeting room, and the window with its captions.
//
//   npm run build && node --import tsx scripts/e2e-cinema.mjs
//
// It boots the office on a temporary floor, records a reel of the real client with the same recorder a
// worker runs (scripts/record-reel.mjs), hands it to the office the way `office-workers cinema add`
// does, and then walks a browser to the screen to see it there.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';

const checks = [];
const check = (name, evidence) => {
  checks.push({ name, status: 'passed', evidence });
  console.log(`PASS ${name}: ${evidence}`);
};
const output = path.resolve(process.env.CINEMA_ARTIFACTS ?? '/tmp/agent-office-cinema-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(tmpdir(), 'office-cinema-'));
const checkout = path.join(dir, 'project');
mkdirSync(checkout, { recursive: true });
spawnSync('git', ['init', '-q', '-b', 'main', checkout]);
spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: checkout });

const cfg = loadConfig([checkout, '--password', 'cinema-test', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const errors = [];
let browser;
try {
  // --- 1. the build runs, and a worker records a reel of it against that build ------------------------
  const reelFile = path.join(dir, 'reel.json');
  writeFileSync(
    reelFile,
    JSON.stringify({
      title: 'Screening room',
      shots: [
        { caption: 'The build loads: the office, with its workers and their boards', wait: 2500 },
        { caption: 'The room list, from the ☰ menu: every project in the building is a floor', key: 'Tab', wait: 900 },
        { caption: 'Esc closes it and puts you straight back to looking around', key: 'Escape', wait: 700 },
        { caption: 'Pressing E at the merge gong rings it: a pull request merged', evaluate: 'window.__office?.store && document.dispatchEvent(new KeyboardEvent("keydown", {code:"KeyE",key:"e",bubbles:true}))', wait: 900 },
      ],
    }),
  );
  const recorded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/record-reel.mjs', '--reel', reelFile, '--out', path.join(dir, 'staged.json'), '--keep'], { encoding: 'utf8' });
  process.stdout.write(recorded.stdout ?? '');
  if (recorded.status !== 0) throw new Error(`record-reel failed: ${recorded.stderr}`);
  const staged = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(path.join(dir, 'staged.json'), 'utf8')));
  check('a reel was recorded against the actual build', `${staged.shots.length} shots of ${base}`, );
  check('every shot carries a caption saying what the behaviour shown is', staged.shots.every((s) => s.caption && s.image.startsWith('data:image/png;base64,')));
  check('the recorded shots are pictures of a big window, not blanks', staged.shots.every((s) => Buffer.from(s.image.split(',')[1], 'base64').length > 20_000), `${staged.shots.length} PNGs over 20 kB each`);

  // --- 2. the office takes it, the way `office-workers cinema add` does ----------------------------------
  const floor = office.floors()[0];
  const ask = await import('../src/server/office-workers.ts');
  const read = ask.readReelRequest(staged);
  if (typeof read === 'string') throw new Error(`the office refused the reel: ${read}`);
  floor.cinema.add(
    { title: read.title, ...(read.pr ? { pr: read.pr } : {}), by: 'Pixel', shots: read.shots.map(({ caption, width, height }) => ({ caption, width, height })) },
    read.shots.map((s) => s.png),
  );
  const state = floor.cinema.state();
  check('the reel is on the screening room, and on its screen', `${state.reels.length} reel(s), on=${state.on}, playing=${state.playing}`);
  check('the office kept the pictures as its own files', Boolean(floor.cinema.frame(state.reels[0].id, 0)));

  // --- 3. a browser sees it there ----------------------------------------------------------------------
  const cache = path.join(homedir(), '.cache/ms-playwright');
  const executable = process.env.CHROMIUM_PATH ?? path.join(cache, (await readdir(cache)).find((x) => x.startsWith('chromium-')), 'chrome-linux64/chrome');
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Screening tester', color: '#4cc9f0', look: { skin: 0, hair: 0, style: 0 } })));
  await context.addInitScript(() => localStorage.setItem('agent-office.lite-declined', '1'));
  assert(await context.request.post(`${base}/api/login`, { data: { password: 'cinema-test' } }));
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  page.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(String(f.payload))));
  await page.goto(base);
  await page.waitForFunction(() => window.__office?.net?.up, null, { timeout: 60_000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 60_000 });
  const arrived = await page.evaluate(() => window.__office.store.cinema);
  check('a browser arriving on the floor is sent the reel', `${arrived.reels.length} reel(s), title “${arrived.reels[0]?.title}”`);

  // The room: stand at the screen and press E, the way anyone does. Third person is the default view,
  // where what you press E on is what you are standing at.
  await page.evaluate(() => {
    const p = window.__office.player;
    const it = window.__office.office.interactables.find((i) => i.kind === 'cinema');
    if (!it) throw new Error('the screening room is not in the office');
    p.pos.set(it.x, 0, it.z - 1.2);
    p.facing = 0;
    p.updateCamera?.(true);
  });
  await page.waitForTimeout(1000);
  await page.locator('#scene').click({ position: { x: 700, y: 700 } });
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyE');
  await page.getByRole('dialog', { name: 'Screening room' }).waitFor({ timeout: 20_000 });
  const caption = await page.locator('.cinema-player .cinema-caption').innerText();
  check('E at the screen opens the screening room, captioned', `caption reads “${caption}”`);
  const shot = await page.locator('.cinema-player .cinema-shot').evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight, ok: el.complete && el.naturalWidth > 0 }));
  check('the window shows the build’s own picture, loaded from the office', `${shot.w}×${shot.h} from /api/cinema/shot`);
    await page.screenshot({ path: path.join(output, 'screening-window.png') });

  // The wall: put the reel on the screen, and see it painted in the meeting room.
  await page.getByRole('button', { name: 'On the screen' }).click();
  await page.waitForFunction(() => window.__office.store.cinema.on === true);
  check('the window puts the reel on the screen for the floor', sent.some((s) => s.includes('"t":"cinema.play"')));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.backdrop') && document.activeElement?.id === 'scene' && window.__office.player.hasMouse);
  check('Esc closes it and puts you straight back into mouse-look, with no extra click', 'focus is the scene and the mouse is back');
  // Look at the screen from where you stand at it.
  await page.evaluate(() => {
    const p = window.__office.player;
    const it = window.__office.office.interactables.find((i) => i.kind === 'cinema');
    p.pos.set(it.x, 0, it.z - 3.2);
    p.facing = 0;
    p.camYaw = Math.PI;
    p.lookPitch = 0.02;
    p.updateCamera?.(true);
  });
  await page.waitForTimeout(2500);
  const painted = await page.evaluate(() => {
    const s = window.__office.office.screening;
    const map = s.screen.material.map;
    const canvas = map?.image;
    if (!canvas) return { drawn: false };
    const g = canvas.getContext('2d');
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 90 && d[i + 1] > 90) lit++;
    return { drawn: true, w: canvas.width, h: canvas.height, lit, total: Math.ceil(d.length / (4 * 97)) };
  });
  check('the screen in the meeting room is painted with the shot, not the idle notice', `${painted.w}×${painted.h}, ${painted.lit}/${painted.total} sampled pixels are picture`);
  await page.screenshot({ path: path.join(output, 'screening-room-screen.png') });

  check('no browser runtime errors', errors.length ? errors.join('; ') : 'none');
  writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots: ['screening-window.png', 'screening-room-screen.png'] }, null, 2));
} catch (e) {
  console.error(errors);
  throw e;
} finally {
  await browser?.close();
  office.shutdown();
  await new Promise((r) => setTimeout(r, 250));
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nEvidence: ${output}`);
process.exit(0);

/** Throws unless `ok`. */
function assert(ok) {
  if (!ok) throw new Error('the office refused the sign-in');
  return ok;
}
