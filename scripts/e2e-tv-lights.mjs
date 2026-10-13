// Reproducible desktop checks for the room's light at the TV: the three settings the wall switch and
// the TV window walk through, that they leave the film where it was, and a screenshot of each from
// one viewpoint so they can be compared. npm run build && npm run e2e:tv-lights
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { DESKS, FLOOR, THEATRE_SWITCH, TV } from '../src/shared/layout.ts';
import { positionAt, TV_LIGHTS } from '../src/shared/tv.ts';

const output = path.resolve(process.env.TV_LIGHTS_ARTIFACTS ?? '/tmp/agent-office-tv-lights-evidence');
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-tv-lights-'));
const checkout = path.join(dir, 'f1');
mkdirSync(checkout);
execFileSync('git', ['init', '-b', 'main'], { cwd: checkout, stdio: 'ignore' });
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: checkout, stdio: 'ignore' });
mkdirSync(path.join(dir, '.agent-office'));
writeFileSync(
  path.join(dir, '.agent-office', 'floors.json'),
  JSON.stringify([{ id: 'f1', name: 'Lights floor', dir: checkout, palette: 0, addedBy: 'test', addedAt: Date.now() }]),
);
const cfg = loadConfig(['--home', dir, '--port', '4600', '--password', 'tv-lights-test', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;
const floor = office.floors()[0];
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find((x) => x.startsWith('chromium-')), 'chrome-linux64/chrome');

/**
 * The room's walls: the TV and the switch are both on the east wall at x = FLOOR.maxX, facing west
 * back into the room, so standing off it and looking east (-PI/2, the camera's -Z) faces them.
 */
const EAST = -Math.PI / 2;
/**
 * Where every screenshot is taken from: back across the lounge looking north-east, so the picture is
 * in shot with the desks, the walkway and the workers behind it — the things the middle setting has to
 * keep visible. The same spot for all three, so they can be compared like for like.
 */
const VIEW = { x: FLOOR.maxX - 11, z: 8.5, yaw: EAST + 0.5 };
/** Where you stand to use the switch on the wall, looking at it: the reach the plate is given. */
const AT_SWITCH = { x: THEATRE_SWITCH.x - 1.1, z: THEATRE_SWITCH.z, yaw: EAST };
/** Where you stand at the TV, looking at the screen. */
const AT_TV = { x: TV.x - 4.5, z: TV.z, yaw: EAST };
/** What the sky is eased to in each setting, so a screenshot is only taken once it has got there. */
const DOWN = { bright: 0, dim: 0.42, off: 1 };
/** How warm the room's light has gone in each setting, as the sky holds it. */
const WARM = { bright: 0, dim: 1, off: 0 };
const SHOTS = { bright: '01-light-bright.png', dim: '02-light-dim.png', off: '03-light-off.png' };

const checks = [];
const check = (name, evidence) => {
  checks.push({ name, status: 'passed', evidence });
  console.log(`PASS ${name}: ${evidence}`);
};
let browser;
let page;
const errors = [];
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1000, height: 640 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Lights tester', color: '#ef476f', look: { skin: 0, hair: 0, style: 0 } }));
    // Freeze the frame loop for screenshots so SwiftShader can drain its GPU queue.
    const raf = window.requestAnimationFrame.bind(window);
    const pending = [];
    window.requestAnimationFrame = (fn) => raf((time) => { if (window.__freeze) pending.push(fn); else fn(time); });
    window.__unfreeze = () => { window.__freeze = false; pending.splice(0).forEach((fn) => raf(fn)); };
  });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  assert.ok((await context.request.post(base + '/api/login', { data: { password: 'tv-lights-test' } })).ok());
  await page.goto(base + '/?floor=f1');
  await page.waitForFunction(() => window.__office?.player?.enabled && window.__office.store.floor === 'f1' && window.__office.ctx.inOffice());
  await page.waitForSelector('#loading', { state: 'hidden' });
  check('bootstrap', 'An authenticated floor is ready in the browser.');

  // Somebody at a desk, so the screenshots have a worker in them to be able to see (or not).
  const desk = DESKS[0];
  const hired = floor.workers.spawn(desk.id, 'lights fixture', undefined, false, 'shell');
  assert.equal(typeof hired, 'object', `a worker at ${desk.id}: ${hired}`);
  await page.waitForFunction((id) => window.__office.store.workers.has(id), hired.id);
  check('fixture worker', `A worker is at desk ${desk.id} (${hired.id}), so there is a person in shot to see by.`);

  /**
   * Puts you somewhere and turns your view that way. First person aims with `camYaw`, which every
   * frame overwrites `facing` from, so that is the one to set for the switch and the TV to be found.
   */
  const stand = (where) =>
    page.evaluate(({ x, z, yaw }) => {
      const p = window.__office.player;
      p.seat = null;
      p.pos.set(x, 0, z);
      if (yaw !== undefined) {
        p.camYaw = yaw;
        p.facing = yaw + Math.PI;
        p.lookPitch = 0;
      }
    }, where);
  /** Waits for the room's light to finish easing into `mode`. */
  const settled = (mode) =>
    page.waitForFunction(
      ({ down, warm }) => {
        const sky = window.__office.sky;
        return Math.abs(sky.roomDown - down) < 0.005 && Math.abs(sky.roomWarm - warm) < 0.005;
      },
      { down: DOWN[mode], warm: WARM[mode] },
      { timeout: 20000 },
    );
  /** Sets the floor's setting the way the controls do, from the page. */
  const setLight = (mode) => page.evaluate((m) => window.__office.net.send({ t: 'tv.lights', light: m }), mode);
  /**
   * Takes the picture. The browser refusing the TV player's sound repeats a toast every few seconds
   * (headless autoplay policy, nothing to do with the lights), so the toast layer is hidden for the
   * shot itself and put straight back: it would otherwise sit over the middle of every screenshot.
   */
  const capture = async (name) => {
    await page.evaluate(() => {
      const el = document.getElementById('toasts');
      el.dataset.shotHidden = el.style.display;
      el.style.display = 'none';
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => { window.__freeze = true; resolve(); })));
    const buffer = await page.screenshot({ path: path.join(output, name), timeout: 90000, animations: 'disabled' });
    await page.evaluate(() => {
      const el = document.getElementById('toasts');
      el.style.display = el.dataset.shotHidden ?? '';
      window.__unfreeze();
    });
    return buffer;
  };
  /**
   * The average colour of a patch of a screenshot, read in the page so it needs no image library: a
   * bit of the back wall above the desks, and a bit of the floor in front of them — what somebody has
   * to be able to see by and walk on in the middle setting.
   */
  const measure = (buffer) =>
    page.evaluate(async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const patch = (fx, fy, w, hh) => {
        const d = g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), w, hh).data;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        return { r: r / n, g: gg / n, b: b / n };
      };
      return { wall: patch(0.33, 0.2, 60, 40), floor: patch(0.45, 0.62, 60, 40) };
    }, `data:image/png;base64,${buffer.toString('base64')}`);
  const light = () => page.evaluate(() => window.__office.store.tv.light);
  const hintText = () => page.textContent('#hint');
  /** Waits for the hint bar to say what it says, which it only redraws when it changes. */
  const hintIs = (text) => page.waitForFunction((t) => (document.getElementById('hint')?.textContent ?? '').includes(t), text);

  // --- the wall switch, which is a plate in the room: stand at it and press E ----------------------
  await stand(AT_SWITCH);
  await hintIs(TV_LIGHTS.bright.label);
  const atSwitch = (await hintText()) ?? '';
  assert.match(atSwitch, new RegExp(TV_LIGHTS.dim.label), 'and where E takes it next');
  assert.equal(await light(), 'bright', 'a floor starts with the lights up');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__office.store.tv.light === 'dim');
  await hintIs(TV_LIGHTS.dim.label);
  check('hint bar', `The hint bar reads "${atSwitch.trim()}" at the plate: the setting the room is in, and the one E takes it to.`);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__office.store.tv.light === 'off');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__office.store.tv.light === 'bright');
  check('wall switch', `E at the plate walks the room ${TV_LIGHTS.bright.label} → ${TV_LIGHTS.dim.label} → ${TV_LIGHTS.off.label} → ${TV_LIGHTS.bright.label}.`);
  await settled('bright');
  await capture('04-wall-switch-hint.png');

  // --- the same switch in the TV window, and the modal's own ✕ --------------------------------------
  await stand(AT_TV);
  await hintIs('Office TV');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.tv', { state: 'visible' });
  // The window has the dance floor's own two buttons on it as well, so pick out the room's light.
  const modes = await page.$$eval('.modal.tv [role=radiogroup][aria-label="The room\'s light"] [role=radio]', (els) => els.map((el) => ({ text: el.textContent.trim(), on: el.getAttribute('aria-checked') })));
  assert.deepEqual(modes.map((m) => m.text), ['💡 Lights up', '🕯️ Warm dim', '🎬 Lights out']);
  // The walk round the switch left the room lit, and the window says so.
  assert.equal(modes.find((m) => m.text.includes(TV_LIGHTS.bright.label)).on, 'true', 'the window shows the setting the room is in');
  const LIGHTS = '.modal.tv [aria-label="The room\'s light"] [role=radio]';
  await page.click(`${LIGHTS}:has-text("Warm dim")`);
  await page.waitForFunction(() => window.__office.store.tv.light === 'dim');
  await page.click(`${LIGHTS}:has-text("Lights out")`);
  await page.waitForFunction(() => window.__office.store.tv.light === 'off');
  await page.click(`${LIGHTS}:has-text("Lights up")`);
  await page.waitForFunction(() => window.__office.store.tv.light === 'bright');
  check('tv window', `The window offers all three (${modes.map((m) => m.text).join(' / ')}), shows which one is on, and puts the room in each one clicked.`);
  await capture('05-tv-window.png');
  assert.ok(await page.$('.modal.tv .close'), 'the window has its top-right ✕');
  await page.click('.modal.tv .close');
  await page.waitForSelector('.modal.tv', { state: 'detached' });
  // Closing by ✕ puts you straight back in the office: still facing the TV, the hint bar drawing
  // again, and the mouse given back without a click on the canvas. The browser took the mouse for the
  // ✕ click, so the first key press is the one that takes it back (see backToGame in input/focus.ts),
  // and the press after that is the office's own.
  assert.equal(await page.evaluate(() => window.__office.player.enabled), true, 'the game has the keyboard again');
  await hintIs('Office TV');
  // No click on the canvas. The office asks the browser for the mouse back as soon as the window
  // closes (see backToGame in input/focus.ts); where the browser won't give it, the first key press
  // takes it, which is the office's own documented way back rather than an extra click.
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 5000 });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.tv', { state: 'visible' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.tv', { state: 'detached' });
  await hintIs('Office TV');
  check('modal close', '✕ and Esc both close the TV window and leave you facing the TV with the hint bar back and no click on the canvas; E takes the mouse the ✕ click had, and the next one opens the window again.');
  await page.keyboard.press('Escape');

  // --- the picture carries on through all of it ----------------------------------------------------
  await page.evaluate(() => window.__office.net.send({ t: 'tv.play', url: 'https://example.com/clip.mp4', position: 100 }));
  await page.waitForFunction(() => window.__office.store.tv.on && window.__office.store.tv.playing);
  const at = floor.tv.state().at;
  for (const mode of ['off', 'dim', 'bright', 'dim']) {
    await setLight(mode);
    await page.waitForFunction((m) => window.__office.store.tv.light === m, mode);
  }
  const s = floor.tv.state();
  assert.equal(s.at, at, "changing the room's light does not move the second the position is measured from");
  assert.equal(s.playing, true, 'and it does not stop the picture');
  assert.ok(positionAt(s, Date.now()) >= 100, 'the film carried on rather than jumping');
  check('playback', `The film was at ${s.position.toFixed(1)}s and playing before the light changed, and is still playing at ${positionAt(s, Date.now()).toFixed(1)}s after all three settings and back.`);

  // --- one viewpoint, three settings --------------------------------------------------------------
  const levels = {};
  const pixels = {};
  for (const mode of ['bright', 'dim', 'off']) {
    await setLight(mode);
    await settled(mode);
    levels[mode] = await page.evaluate(() => window.__office.sky.roomDown);
    await stand(VIEW);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Measured off the very picture that is saved, in the setting it was taken in.
    pixels[mode] = await measure(await capture(SHOTS[mode]));
  }
  const where = Object.entries(levels).map(([m, d]) => `${m} ${d.toFixed(2)}`).join(', ');
  check('screenshots', `Three settings from one spot in the lounge: ${Object.values(SHOTS).join(', ')} in ${output}.`);
  assert.ok(levels.bright < levels.dim && levels.dim < levels.off, `the room's light comes down in steps (${where})`);
  check('dimming', `The sky eases to ${where}, so each setting is darker than the one before it.`);

  // The middle setting is the one that has to be both warm and usable, so judge the saved pictures
  // by their own pixels rather than by the numbers the sky was holding.
  const brightWall = pixels.bright.wall;
  const dimWall = pixels.dim.wall;
  const offWall = pixels.off.wall;
  const warmth = (p) => p.r / Math.max(1, p.b);
  const seen = (p) => (p.r + p.g + p.b) / 3;
  // Dimmer than lights up, brighter than lights out: that is the whole point of the middle setting.
  assert.ok(seen(dimWall) < seen(brightWall), `the wall is dimmer than with the lights up (${seen(dimWall).toFixed(0)} vs ${seen(brightWall).toFixed(0)})`);
  assert.ok(seen(dimWall) > seen(offWall), `and brighter than with them out (${seen(dimWall).toFixed(0)} vs ${seen(offWall).toFixed(0)})`);
  // Warm: more red than blue, where lights up and lights out are neutral.
  assert.ok(warmth(dimWall) > warmth(brightWall), `the wall reads warm (r/b ${warmth(dimWall).toFixed(2)} vs ${warmth(brightWall).toFixed(2)})`);
  // And enough light on the floor to walk on and see a desk by.
  assert.ok(seen(pixels.dim.floor) > seen(pixels.off.floor), `the walkway is lit in the middle setting (${seen(pixels.dim.floor).toFixed(0)} vs ${seen(pixels.off.floor).toFixed(0)})`);
  check(
    'measured light',
    `The wall's own pixels: lights up ${seen(brightWall).toFixed(0)}, warm dim ${seen(dimWall).toFixed(0)}, lights out ${seen(offWall).toFixed(0)} — and the warm dim is warmer than lights up (r/b ${warmth(dimWall).toFixed(2)} vs ${warmth(brightWall).toFixed(2)}). The walkway is ${seen(pixels.dim.floor).toFixed(0)} against ${seen(pixels.off.floor).toFixed(0)} with the lights out.`,
  );
  assert.deepEqual(errors, [], `the page threw: ${errors.join('; ')}`);
  check('no page errors', 'Nothing threw in the page while the settings were being changed.');
} finally {
  await browser?.close();
  office.shutdown();
}
writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, screenshots: Object.values(SHOTS) }, null, 2));
process.exit(checks.length === 11 ? 0 : 1);
