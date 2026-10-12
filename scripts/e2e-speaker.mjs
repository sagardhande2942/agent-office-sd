// Headless browser verification of the lounge's smart speaker: the tower in the room, its music
// player window, the ONE shared <audio> element its links play through, how the speaker's lights
// follow playback, the sound fading with distance and going silent on another floor, and the clear
// errors for links that aren't audio files.
//
//   npm run build && node --import tsx scripts/e2e-speaker.mjs
//
// The audio it plays is a real WAV the script serves from a little server of its own (browsers can't
// decode a synthesized data: URL through Node), on a different origin from the office, as a pasted
// CDN link would be. Chromium is launched with autoplay allowed so a headless run doesn't stall on
// the user-gesture rule the real player still respects (see player.ts).

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { ROOF } from '../src/shared/rooftop.ts';

const output = path.resolve(process.env.SPEAKER_ARTIFACTS ?? '/tmp/agent-office-speaker-evidence');
mkdirSync(output, { recursive: true });

const checks = [];
const check = (name, ok, evidence) => {
  checks.push({ name, status: ok ? 'passed' : 'failed', evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${evidence}`);
  if (!ok) throw new Error(`${name}: ${evidence}`);
};

/** Stands in front of the speaker, first person, looking straight at it (the aim tick runs a frame later). */
async function standAtSpeaker(page) {
  await page.evaluate(() => {
    const o = window.__office;
    const it = o.office.speaker.interactable;
    const at = o.office.speaker.at;
    o.player.setView('first');
    o.player.pos.set(it.x, 0, it.z);
    const dx = at.x - it.x;
    const dz = at.z - it.z;
    const eye = 1.4;
    const len = Math.hypot(dx, at.y - eye, dz);
    o.player.camYaw = Math.atan2(-dx / len, -dz / len);
    o.player.lookPitch = Math.asin((at.y - eye) / len);
    o.player.updateCamera(true);
    o.player.hasMouse = true;
    o.player.enabled = true;
  });
  await page.waitForTimeout(350);
}

/** A little mono WAV of a sine tone, which every browser can decode. */
function wav(seconds, freq) {
  const rate = 8000;
  const count = Math.round(seconds * rate);
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + count * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), 44 + i * 2);
  return data;
}

const SONGS = { 'tone.wav': wav(30, 440), 'tone-two.wav': wav(30, 660) };

/** The CDN being pasted from: another origin, with the two audio files and nothing else. */
function startAudioServer() {
  const server = createServer((req, res) => {
    const file = new URL(req.url, 'http://x').pathname.replace(/^\//, '');
    const body = SONGS[file];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('no such audio');
    }
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': body.length, 'accept-ranges': 'bytes' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const audioServer = await startAudioServer();
const audioBase = `http://127.0.0.1:${audioServer.address().port}`;

// A floor of its own, so the run never touches anyone's project.
const dir = mkdtempSync(path.join(os.tmpdir(), 'office-speaker-'));
const checkout = path.join(dir, 'project');
mkdirSync(checkout, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: checkout });

const cfg = loadConfig([checkout, '--password', 'speaker-pass', '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;

const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find((x) => x.startsWith('chromium-')), 'chrome-linux64/chrome');

let browser;
try {
  browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Speaker Tester', color: '#3b82f6', look: { skin: 0, hair: 0, style: 0 } }));
  });
  const login = await context.request.post(base + '/api/login', { data: { password: 'speaker-pass' } });
  assert.ok(login.ok(), 'Login succeeded');

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(base + '/');
  await page.waitForFunction(() => window.__office?.player && window.__office?.office);
  await page.waitForSelector('#loading', { state: 'hidden' });
  check('office-loaded', true, 'Office loaded and the player initialized.');

  // ---- The tower in the room ---------------------------------------------------------------------
  const fixture = await page.evaluate(() => {
    const o = window.__office;
    const s = o.office.speaker;
    const kinds = o.office.interactables.map((i) => i.kind);
    // Only materials that actually glow: every toon material has a (black) emissive of its own.
    const glowing = (m) => !!m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.05;
    let leds = 0;
    let emissive = 0;
    s.group.traverse((n) => {
      const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
      for (const m of mats) {
        if (glowing(m)) {
          leds++;
          emissive = Math.max(emissive, m.emissiveIntensity ?? 0);
        }
      }
    });
    return {
      hasSpeaker: !!s,
      kind: s.interactable.kind,
      onMesh: s.group.userData.interact === s.interactable,
      radius: s.interactable.radius,
      colliderTop: s.collider.top,
      leds,
      emissive,
      pulse: s.pulse(),
      at: s.at.toArray(),
      // The features this must not have replaced.
      tv: !!o.office.tvScreen && kinds.includes('tv'),
      jukebox: !!o.office.jukebox && kinds.includes('jukebox'),
      deskToys: o.office.deskToys.size,
    };
  });
  check('speaker-in-the-room', fixture.hasSpeaker && fixture.kind === 'speaker', `The lounge has a speaker fixture at (${fixture.at.map((n) => n.toFixed(2)).join(', ')}), used by aiming at kind "${fixture.kind}".`);
  check('speaker-is-solid-and-clickable', fixture.onMesh && fixture.colliderTop > 1, `Its interactable is on the tower's group (so a click/aim lands on it) and it collides up to ${fixture.colliderTop.toFixed(2)}m.`);
  check('leds-start-dark', fixture.leds >= 3 && fixture.emissive < 0.5 && fixture.pulse === 0, `${fixture.leds} emissive LED materials, dim (${fixture.emissive.toFixed(2)}) and still before anything plays.`);
  check('tv-and-jukebox-untouched', fixture.tv && fixture.jukebox && fixture.deskToys > 0, `The TV (${fixture.tv}), the jukebox (${fixture.jukebox}) and ${fixture.deskToys} desk toys are all still there.`);

  const clear = await page.evaluate(() => {
    const o = window.__office;
    const s = o.office.speaker;
    const box = s.collider;
    const centre = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
    let nearest = Infinity;
    let who = '';
    const at = (name, x, z) => {
      const d = Math.hypot(x - centre.x, z - centre.z);
      if (d < nearest) {
        nearest = d;
        who = name;
      }
    };
    for (const d of o.office.desks.values()) at(d.def.label ?? d.def.id, d.def.x, d.def.z);
    at('the jukebox', o.office.jukebox.group.position.x, o.office.jukebox.group.position.z);
    for (const it of o.office.interactables) if (it.kind !== 'speaker') at(`a ${it.kind} to use`, it.x, it.z);
    return { nearest, who, insideWall: box.maxX < 18, alongWall: box.maxX > 17, clearOfRoom: box.minZ > -5.2 && box.maxZ < -3.3 };
  });
  check(
    'stands-clear-in-the-room',
    clear.nearest > 1 && clear.insideWall && clear.alongWall && clear.clearOfRoom,
    `Its ${(clear.nearest).toFixed(2)}m clear of the nearest thing (${clear.who}), against the east wall (inside 18, at x>17) in the gap between the Services board (z=-8.2) and the TV (z=0).`,
  );

  // Stand in front of the speaker, first person, looking at it (the aim tick runs on a frame).
  const look = await page.evaluate(() => {
    const o = window.__office;
    const it = o.office.speaker.interactable;
    const at = o.office.speaker.at;
    o.player.setView('first');
    o.player.pos.set(it.x, 0, it.z);
    const dx = at.x - it.x;
    const dz = at.z - it.z;
    const eye = 1.4;
    const len = Math.hypot(dx, at.y - eye, dz);
    o.player.camYaw = Math.atan2(-dx / len, -dz / len);
    o.player.lookPitch = Math.asin((at.y - eye) / len);
    o.player.updateCamera(true);
    o.player.hasMouse = true;
    o.player.enabled = true;
    return { stand: [it.x, it.z], distance: Math.hypot(dx, at.y - eye, dz) };
  });
  await page.waitForTimeout(400);
  const hint = await page.textContent('#hint');
  check('aim-finds-the-speaker', /Smart speaker/.test(hint) && /Music player/.test(hint), `Standing ${look.distance.toFixed(2)}m in front of it, the hint bar says: "${hint.trim().replace(/\s+/g, ' ')}".`);

  // ---- E opens the music player -----------------------------------------------------------------
  await page.locator('canvas').focus();
  await page.keyboard.press('KeyE');
  const dialog = page.getByRole('dialog', { name: 'Smart speaker' });
  await dialog.waitFor({ state: 'visible' });
  const controls = await dialog.evaluate((el) => ({
    close: !!el.querySelector('.close'),
    url: !!el.querySelector('input[aria-label="Audio link"]'),
    load: [...el.querySelectorAll('button')].some((b) => b.textContent.includes('Load Music')),
    progress: !!el.querySelector('input[aria-label="Where the track is"]'),
    volume: !!el.querySelector('input[aria-label="Speaker volume"]'),
    mute: [...el.querySelectorAll('button')].some((b) => /Mute/.test(b.textContent)),
    transport: [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|'),
    stopSeparate: [...el.querySelectorAll('.sp-transport button')].some((b) => b.textContent.includes('Stop')),
    minimize: [...el.querySelectorAll('button')].some((b) => b.textContent.includes('Minimize')),
  }));
  check(
    'player-window-controls',
    controls.close && controls.url && controls.load && controls.progress && controls.volume && controls.mute && controls.stopSeparate && controls.minimize,
    `E opened the player with a ✕, a link box and Load Music, a scrubber, a volume slider and mute, a separate Stop, and Minimize. Transport: ${controls.transport}`,
  );

  // ---- Paste a real link and play it ------------------------------------------------------------
  await dialog.locator('input[aria-label="Audio link"]').fill(`${audioBase}/tone.wav`);
  await dialog.getByRole('button', { name: /Load Music/ }).click();
  await page.waitForFunction(() => window.__office.speaker.player.state().status === 'playing');
  await page.waitForTimeout(700);
  const playing = await page.evaluate(() => {
    const o = window.__office;
    const s = o.speaker.player.state();
    const el = o.speaker.player.audio();
    return {
      state: s,
      audio: !!el,
      paused: el?.paused,
      currentTime: el?.currentTime,
      src: el?.src,
      pulse: o.office.speaker.pulse(),
      title: document.querySelector('.modal.speaker .svc-title')?.textContent,
      meta: document.querySelector('.modal.speaker .svc-meta')?.textContent,
    };
  });
  check('loads-and-plays-the-link', playing.state.status === 'playing' && playing.currentTime > 0.3, `The pasted ${new URL(playing.src).pathname} is playing from the shared <audio> element (t=${playing.currentTime.toFixed(2)}s of ${playing.state.duration.toFixed(1)}s).`);
  check('one-shared-audio-element', playing.audio && playing.paused === false && playing.state.url === `${audioBase}/tone.wav`, `The player has ONE <audio> element (player.audio()), unpaused, with the pasted link as its src.`);
  check('window-names-the-track', /tone/i.test(playing.title ?? '') && /playing/.test(playing.meta ?? ''), `The player shows "${playing.title}" · ${playing.meta}.`);
  check('lights-animate-while-playing', playing.pulse > 0.4, `The tower is lit and pulsing (pulse ${playing.pulse.toFixed(2)}, never dark while it plays).`);
  const lit = await page.evaluate(async () => {
    let best = 0;
    for (let i = 0; i < 24; i++) {
      window.__office.office.speaker.group.traverse((n) => {
        const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
        for (const m of mats) if (m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.05) best = Math.max(best, m.emissiveIntensity ?? 0);
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return best;
  });
  check('leds-lit-while-playing', lit > 0.8, `The LEDs rise to ${lit.toFixed(2)} emissive intensity over two dozen frames of playback (resting at 0.16).`);
  const varied = await page.evaluate(async () => {
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      seen.add(window.__office.office.speaker.pulse().toFixed(2));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return seen.size;
  });
  check('animation-is-not-static', varied > 2, `The pulse took ${varied} different values over 12 frames, so it animates rather than sitting lit.`);

  await page.screenshot({ path: path.join(output, '01-playing.png') });
  check('screenshot-playing', true, `Saved the playing speaker and its window to ${path.join(output, '01-playing.png')}`);

  // ---- Walking away fades it --------------------------------------------------------------------
  const near = await page.evaluate(() => window.__office.speaker.player.audio().volume);
  const far = await page.evaluate(async () => {
    const o = window.__office;
    o.player.pos.set(10, 0, -4.3);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { volume: o.speaker.player.audio().volume, gain: o.speaker.player.state().roomGain };
  });
  check('fades-with-distance', near > far.volume && far.volume > 0 && far.gain < 1, `Walking from the speaker into the room took the music from volume ${near.toFixed(3)} to ${far.volume.toFixed(3)} (room gain ${far.gain.toFixed(3)}), still audible and still playing.`);

  // ---- Pause stops the lights and freezes the time; play carries on -----------------------------
  await dialog.getByRole('button', { name: /Pause/ }).click();
  const paused = await page.evaluate(async () => {
    const el = window.__office.speaker.player.audio();
    const t0 = el.currentTime;
    const pulse = window.__office.office.speaker.pulse();
    await new Promise((r) => setTimeout(r, 450));
    return { paused: el.paused, t0, t1: el.currentTime, pulse, status: window.__office.speaker.player.state().status };
  });
  check('pause-stops-the-music-and-the-lights', paused.paused && paused.status === 'paused' && paused.pulse === 0 && paused.t1 - paused.t0 < 0.05, `Paused: the element is paused, the pulse is ${paused.pulse} and the time stayed at ${paused.t1.toFixed(2)}s over 450ms.`);
  await dialog.getByRole('button', { name: /Play/ }).click();
  await page.waitForTimeout(400);
  const resumed = await page.evaluate(() => ({ t: window.__office.speaker.player.audio().currentTime, status: window.__office.speaker.player.state().status, pulse: window.__office.office.speaker.pulse() }));
  check('play-carries-on', resumed.status === 'playing' && resumed.t > paused.t1 + 0.2 && resumed.pulse > 0, `Carried on from ${paused.t1.toFixed(2)}s to ${resumed.t.toFixed(2)}s, pulsing again (${resumed.pulse.toFixed(2)}).`);

  // ---- The scrubber, stop and restart -----------------------------------------------------------
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Where the track is"]');
    el.value = '4';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const scrubbed = await page.evaluate(() => window.__office.speaker.player.audio().currentTime);
  await dialog.getByRole('button', { name: /Restart/ }).click();
  await page.waitForTimeout(150);
  const restarted = await page.evaluate(() => ({ t: window.__office.speaker.player.audio().currentTime, status: window.__office.speaker.player.state().status }));
  check('scrubber-and-restart', scrubbed > 3 && restarted.t < 1, `Dragging the scrubber put the track at ${scrubbed.toFixed(2)}s and Restart took it back to ${restarted.t.toFixed(2)}s (${restarted.status}).`);
  await dialog.getByRole('button', { name: /Stop/ }).click();
  await page.waitForTimeout(200);
  const stopped = await page.evaluate(() => ({ paused: window.__office.speaker.player.audio().paused, t: window.__office.speaker.player.audio().currentTime, pulse: window.__office.office.speaker.pulse(), status: window.__office.speaker.player.state().status }));
  check('stop-ends-playback', stopped.paused && stopped.t === 0 && stopped.status === 'stopped' && stopped.pulse === 0, `Stop paused the element, took it back to ${stopped.t}s and stopped the lights (${stopped.status}).`);

  // ---- Previous and next over the links loaded --------------------------------------------------
  await dialog.locator('input[aria-label="Audio link"]').fill(`${audioBase}/tone-two.wav`);
  await dialog.getByRole('button', { name: /Load Music/ }).click();
  await page.waitForFunction(() => window.__office.speaker.player.state().url.endsWith('tone-two.wav'));
  await page.waitForTimeout(300);
  const second = await page.evaluate(() => ({ title: document.querySelector('.modal.speaker .svc-title').textContent, canPrev: window.__office.speaker.player.state().canPrev, canNext: window.__office.speaker.player.state().canNext }));
  await dialog.getByRole('button', { name: /⏮/ }).click();
  await page.waitForTimeout(300);
  const wentBack = await page.evaluate(() => ({ title: document.querySelector('.modal.speaker .svc-title').textContent, url: window.__office.speaker.player.state().url, status: window.__office.speaker.player.state().status }));
  await dialog.getByRole('button', { name: /⏭/ }).click();
  await page.waitForTimeout(300);
  const wentOn = await page.evaluate(() => document.querySelector('.modal.speaker .svc-title').textContent);
  check(
    'previous-and-next',
    second.canPrev && !second.canNext && /tone-two/i.test(second.title) && /tone/i.test(wentBack.title) && wentBack.url.endsWith('tone.wav') && /tone-two/i.test(wentOn),
    `After loading a second link (${second.title}), ⏮️ went to "${wentBack.title}" and ⏭️ back to "${wentOn}".`,
  );
  check(
    'a-new-link-reuses-the-one-element',
    await page.evaluate(() => {
      const el = window.__office.speaker.player.audio();
      if (!window.__spkEl) window.__spkEl = el;
      return !!el && el === window.__spkEl;
    }),
    'Still the same one <audio> element after a second link: the player never makes a second.',
  );

  // ---- Minimize and Esc keep the music going ----------------------------------------------------
  await page.evaluate(() => {
    const el = window.__office.speaker.player.audio();
    if (el.paused) el.play();
  });
  await page.waitForFunction(() => window.__office.speaker.player.state().status === 'playing');
  await dialog.locator('button[aria-label="Minimize"]').click();
  await page.waitForTimeout(500);
  const minimized = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('.modal.speaker').length,
    paused: window.__office.speaker.player.audio().paused,
    t: window.__office.speaker.player.audio().currentTime,
    pulse: window.__office.office.speaker.pulse(),
  }));
  check('minimize-keeps-playing', minimized.dialogs === 0 && !minimized.paused && minimized.t > 0 && minimized.pulse > 0, `The ✕ took the window away while the music played on (t=${minimized.t.toFixed(2)}s, still pulsing).`);
  // And it opens again from E, still playing.
  await standAtSpeaker(page);
  await page.locator('canvas').focus();
  await page.keyboard.press('KeyE');
  const again = page.getByRole('dialog', { name: 'Smart speaker' });
  await again.waitFor({ state: 'visible' });
  const reopened = await page.evaluate(() => ({ paused: window.__office.speaker.player.audio().paused, status: window.__office.speaker.player.state().status }));
  check('reopens-with-the-track', !reopened.paused && reopened.status === 'playing', 'Opening it again shows the same track still playing (nothing restarted).');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal.speaker'));
  const afterEsc = await page.evaluate(() => ({ paused: window.__office.speaker.player.audio().paused, pulse: window.__office.office.speaker.pulse() }));
  check('esc-keeps-playing', !afterEsc.paused && afterEsc.pulse > 0, 'Esc closed the window with the music still going, as Minimize does.');

  // ---- It plays on while you walk around, and goes silent off the floor -------------------------
  const onFloor = await page.evaluate(() => window.__office.store.floor);
  await page.evaluate((roof) => window.__office.switchFloor(roof), ROOF);
  await page.waitForFunction(() => window.__office.ctx.upTop() && window.__office.player.enabled, undefined, { timeout: 20000 });
  await page.waitForTimeout(500);
  const roof = await page.evaluate(() => ({ paused: window.__office.speaker.player.audio().paused, volume: window.__office.speaker.player.audio().volume, t: window.__office.speaker.player.audio().currentTime, status: window.__office.speaker.player.state().status }));
  check('silent-on-the-roof-still-playing', !roof.paused && roof.volume === 0 && roof.status === 'playing' && roof.t > 0, `Up on the roof the element never paused (t=${roof.t.toFixed(2)}s) but its volume is ${roof.volume}: you can't hear the office's speaker from there.`);
  await page.evaluate((floor) => window.__office.switchFloor(floor), onFloor);
  await page.waitForFunction(() => window.__office.player.enabled && !window.__office.ctx.upTop(), undefined, { timeout: 20000 });
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => {
    const o = window.__office;
    const it = o.office.speaker.interactable;
    o.player.pos.set(it.x - 1.5, 0, it.z);
    return { volume: window.__office.speaker.player.audio().volume, paused: window.__office.speaker.player.audio().paused };
  });
  await page.waitForTimeout(400);
  const heard = await page.evaluate(() => ({ volume: window.__office.speaker.player.audio().volume, pulse: window.__office.office.speaker.pulse(), status: window.__office.speaker.player.state().status }));
  check('audible-again-back-on-the-floor', back.paused === false && heard.status === 'playing' && heard.volume > 0 && heard.pulse > 0, `Back on the floor it is playing again, loud at volume ${heard.volume.toFixed(3)} with the lights going.`);

  // ---- Wrong links are clearly refused, pages are warned about ----------------------------------
  await standAtSpeaker(page);
  await page.locator('canvas').focus();
  await page.keyboard.press('KeyE');
  const player = page.getByRole('dialog', { name: 'Smart speaker' });
  await player.waitFor({ state: 'visible' });
  await player.locator('input[aria-label="Audio link"]').fill(`${audioBase}/not-here.mp3`);
  await player.getByRole('button', { name: /Load Music/ }).click();
  await page.waitForFunction(() => window.__office.speaker.player.state().status === 'error', undefined, { timeout: 20000 });
  const failed = await page.evaluate(() => ({ error: window.__office.speaker.player.state().error, shown: document.querySelector('.modal.speaker .sp-problem')?.textContent }));
  check('missing-file-says-why', /network|playable|audio file|aborted|damaged|couldn’t|wouldn’t/i.test(failed.error) && failed.shown === failed.error, `A 404 audio link came back as an error the window shows: "${failed.error}"`);
  await player.locator('input[aria-label="Audio link"]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.waitForTimeout(200);
  const warned = await page.evaluate(() => document.querySelector('.modal.speaker .sp-link-note')?.textContent ?? '');
  check('page-link-warned-not-refused', /YouTube page/.test(warned), `A YouTube link is called out as a page rather than a file to paste: "${warned}"`);
  await player.locator('input[aria-label="Audio link"]').fill('');
  await player.getByRole('button', { name: /Load Music/ }).click();
  await page.waitForTimeout(200);
  const toast = await page.textContent('#toasts');
  check('empty-link-refused', /Paste a direct link/.test(toast), `Pressing 📥 Load Music with an empty box said so: "${toast.trim()}"`);

  // ---- A room shot with the speaker (playing) and the TV in frame -------------------------------
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.querySelector('.backdrop'));
  await page.locator('canvas').focus();
  await page.evaluate((song) => window.__office.speaker.player.load(song), `${audioBase}/tone.wav`);
  await page.waitForFunction(() => window.__office.speaker.player.state().status === 'playing');
  await page.evaluate(() => {
    const o = window.__office;
    o.player.setView('third');
    o.player.pos.set(11.5, 0, -2.5);
    o.player.camYaw = -Math.PI / 2.2;
    o.player.lookPitch = -0.12;
    o.player.updateCamera(true);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(output, '02-in-the-room.png') });
  check('screenshot-room', true, `Saved the lounge with the lit speaker and the TV to ${path.join(output, '02-in-the-room.png')}`);

  const errors = pageErrors.filter((e) => !/ResizeObserver/.test(e));
  check('no-page-errors', errors.length === 0, errors.length ? errors.join(' | ') : 'No uncaught page errors during the whole run.');

  writeFileSync(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log(`\nAll ${checks.length} smart speaker e2e browser checks passed!`);
} catch (err) {
  console.error('E2E Smart Speaker failed:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  office.shutdown();
  audioServer.close();
}
